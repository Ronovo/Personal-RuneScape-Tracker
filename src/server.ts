import os from 'os';
import { createApp } from './lib/app.js';
import { jwtAuthConfigured, lanModeConfigured, mintWildcardToken } from './lib/auth.js';

const PORT = process.env.PORT || 4123;

if (process.env.SYNC_TOKEN?.trim()) {
  console.error(
    '[auth] SYNC_TOKEN was removed in v1. Set JWT_SECRET, and LAN_MODE=1 for LAN posture. See CHANGELOG.',
  );
  process.exit(1);
}

const app = createApp();

// Non-internal IPv4 addresses so a phone on the same LAN can open the app.
function lanUrls(port: number | string): string[] {
  const urls: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${port}`);
    }
  }
  return urls;
}

// 0.0.0.0 so it's reachable on LAN/phone, not just localhost.
const server = app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`OSRS Tracker running at http://localhost:${PORT}`);
  for (const url of lanUrls(PORT)) {
    console.log(`Phone on LAN: ${url}`);
  }

  if (process.env.LAN_MODE?.trim() && !jwtAuthConfigured()) {
    console.warn('[auth] LAN_MODE is set but JWT_SECRET is missing — auth is disabled (guest mode).');
  }
  if (lanModeConfigured()) {
    // Printing the token is a convenience, not a reason to lose the server:
    // an unhandled rejection here would take the process down at startup.
    mintWildcardToken()
      .then((token) => {
        console.log(`\nLAN mode — stable plugin/browser API token:\n  ${token}\n`);
      })
      .catch((err: unknown) => {
        console.error('[auth] could not mint the LAN token:', err);
      });
  }
});

// `docker stop` sends SIGTERM; Ctrl-C sends SIGINT. Stop accepting connections
// and let in-flight writes finish, with a hard 5s backstop.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`\n${sig} received - closing server.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — an old tracker process is probably still running.`);
    console.error('Run "npm run stop" to free the port, then "npm start" again.');
  } else {
    console.error(err);
  }
  process.exit(1);
});
