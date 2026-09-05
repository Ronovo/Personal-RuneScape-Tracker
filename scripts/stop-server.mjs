// Stops whatever is listening on the tracker port. Orphaned `node dist/server.js`
// processes are common after closing a terminal without Ctrl+C or killing a
// background shell — this gives npm run stop a single command to clear them.

import { execSync } from 'child_process';

const port = String(process.env.PORT || 4123);

// This kills whatever it finds, so the port has to match exactly. `findstr
// :4123` matched by substring, so :41230-:41239 came back too and an unrelated
// LISTENING process could be taskkill'd. Parse the local-address column
// instead: "TCP  0.0.0.0:4123  0.0.0.0:0  LISTENING  1234", or "[::]:4123" on
// IPv6 - both end with exactly ":<port>".
function pidsOnPortWin32() {
  let out;
  try {
    out = execSync('netstat -ano -p TCP', { encoding: 'utf8' });
  } catch {
    return [];
  }

  const pids = new Set();
  for (const line of out.split('\n')) {
    const parts = line.trim().split(/\s+/);
    // proto, local, foreign, state, pid
    if (parts.length < 5 || parts[3] !== 'LISTENING') continue;
    if (!parts[1].endsWith(`:${port}`)) continue;
    const pid = parts.at(-1);
    if (pid && pid !== '0') pids.add(pid);
  }
  return [...pids];
}

function pidsOnPortUnix() {
  let out;
  try {
    out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' });
  } catch {
    return [];
  }
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

const pids = process.platform === 'win32' ? pidsOnPortWin32() : pidsOnPortUnix();

if (!pids.length) {
  console.log(`Nothing listening on port ${port}.`);
  process.exit(0);
}

for (const pid of pids) {
  if (process.platform === 'win32') {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'inherit' });
  } else {
    execSync(`kill ${pid}`, { stdio: 'inherit' });
  }
  console.log(`Stopped PID ${pid} (port ${port}).`);
}
