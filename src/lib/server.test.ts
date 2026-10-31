import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

// server.ts listens as soon as it is imported and ends the process on a signal or a listen error, so each case
// imports its own copy on a free port, and process.exit only records what it was asked to do.
const exits: number[] = [];
process.exit = ((code?: number) => {
  exits.push(code ?? 0);
}) as typeof process.exit;

const logs: string[] = [];
for (const level of ['log', 'warn', 'error'] as const) {
  console[level] = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(check(), 'timed out');
}

let copies = 0;
async function start(env: Record<string, string | undefined>, port?: number): Promise<number> {
  const chosen = port ?? await freePort();
  for (const [key, value] of Object.entries({ PORT: String(chosen), ...env })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await import(`../server.js?copy=${++copies}`);
  return chosen;
}

test('the server answers on the port it is given and says where to reach it', async () => {
  const port = await start({ LAN_MODE: undefined, JWT_SECRET: undefined });
  await until(() => logs.includes(`OSRS Tracker running at http://localhost:${port}`));
  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(res.status, 200);
  for (const line of logs.filter((l) => l.startsWith('Phone on LAN: '))) {
    assert.match(line, /^Phone on LAN: http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/);
  }
  assert.equal(logs.some((l) => l.includes('[auth]')), false);
});

test('LAN mode without a JWT secret warns that sign-in is off', async () => {
  const port = await start({ LAN_MODE: '1', JWT_SECRET: undefined });
  await until(() => logs.includes(`OSRS Tracker running at http://localhost:${port}`));
  assert.ok(logs.includes('[auth] LAN_MODE is set but JWT_SECRET is missing - auth is disabled (guest mode).'));
});

test('LAN mode prints the plugin token', async () => {
  await start({ LAN_MODE: '1', JWT_SECRET: 'a-test-secret' });
  await until(() => logs.some((l) => l.includes('LAN mode - stable plugin/browser API token')));
  const line = logs.find((l) => l.includes('LAN mode - stable plugin/browser API token'))!;
  assert.match(line, /\n {2}[\w-]+\.[\w-]+\.[\w-]+\n/);
});

test('a port already in use says how to free it', async () => {
  const blocker = net.createServer().listen(0, '0.0.0.0');
  await new Promise((resolve) => blocker.once('listening', resolve));
  const { port } = blocker.address() as net.AddressInfo;
  await start({ LAN_MODE: undefined, JWT_SECRET: undefined }, port);
  await until(() => exits.includes(1));
  assert.ok(logs.includes(`Port ${port} is already in use - an old tracker process is probably still running.`));
  assert.ok(logs.includes('Run "npm run stop" to free the port, then "npm start" again.'));
  await new Promise((resolve) => blocker.close(resolve));
});

test('any other listen error is printed and ends the process', async () => {
  const denied = Object.assign(new Error('listen EACCES: permission denied'), { code: 'EACCES' });
  const listen = mock.method(net.Server.prototype, 'listen', function (this: net.Server) {
    process.nextTick(() => this.emit('error', denied));
    return this;
  });
  exits.length = 0;
  try {
    await start({ LAN_MODE: undefined, JWT_SECRET: undefined }, 4124);
    await until(() => exits.includes(1));
  } finally {
    listen.mock.restore();
  }
  assert.ok(logs.includes(String(denied)));
});

test('a server that could not listen does not say it is running', async () => {
  const blocker = net.createServer().listen(0, '0.0.0.0');
  await new Promise((resolve) => blocker.once('listening', resolve));
  const { port } = blocker.address() as net.AddressInfo;
  const from = logs.length;
  exits.length = 0;
  await start({ LAN_MODE: undefined, JWT_SECRET: undefined }, port);
  await until(() => exits.includes(1));
  await new Promise((resolve) => blocker.close(resolve));
  assert.deepEqual(logs.slice(from).filter((l) => l.startsWith('OSRS Tracker running at')), []);
});

// A tracker already running on this computer may hold 4123; either message shows that port was the one used.
test('with no port given it uses 4123', async () => {
  const from = logs.length;
  await start({ PORT: undefined, LAN_MODE: undefined, JWT_SECRET: undefined });
  const used = (l: string) => l === 'OSRS Tracker running at http://localhost:4123'
    || l === 'Port 4123 is already in use - an old tracker process is probably still running.';
  await until(() => logs.slice(from).some(used));
});

test('a stop signal closes the server and exits cleanly', async () => {
  const port = await start({ LAN_MODE: undefined, JWT_SECRET: undefined });
  await until(() => logs.includes(`OSRS Tracker running at http://localhost:${port}`));
  exits.length = 0;
  process.emit('SIGTERM');
  assert.ok(logs.includes('\nSIGTERM received - closing server.'));
  await until(() => exits.includes(0));
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`));
});
