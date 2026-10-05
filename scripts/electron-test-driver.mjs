// Shared by scripts/test-electron-*.mjs: launches the app's real main.js through
// scripts/electron-test-harness.cjs and gives the test a small command channel
// (status / eval / loadURL / capture / quit) plus the events the harness stubs
// report (openExternal / dialog / messageBox).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// dshPort: the port main.js will treat as dsh (DSH_DESKTOP_PORT).
// userData: reuse a directory (to test "second launch"); default is a fresh temp dir.
// setup(userDataDir): runs before launch, e.g. to plant a fake vendored dsh.
export async function launchHarness({ dshPort, env = {}, userData, setup }) {
  const queue = [];
  const waiters = [];
  const pending = new Map();
  const events = [];
  let seq = 0;

  const server = http.createServer((req, res) => {
    if (req.url === '/__cmd') {
      const next = queue.shift();
      if (next) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(next));
      const waiter = (c) => {
        clearTimeout(t);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(c));
      };
      const t = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        res.writeHead(204).end();
      }, 1500);
      waiters.push(waiter);
      return;
    }
    if (req.url === '/__main') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const msg = JSON.parse(body);
        if (msg.type === 'result') pending.get(msg.id)?.(msg);
        else events.push(msg);
        res.writeHead(204).end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  const ownsUserData = !userData;
  const dir = userData || fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-electron-test-'));
  if (setup) setup(dir);

  const electronBin = createRequire(import.meta.url)(path.join(ROOT, 'node_modules/electron'));
  const child = spawn(electronBin, [path.join(ROOT, 'scripts/electron-test-harness.cjs')], {
    env: {
      ...process.env,
      DSH_DESKTOP_PORT: String(dshPort),
      HARNESS_CTRL: `http://127.0.0.1:${server.address().port}`,
      HARNESS_USER_DATA: dir,
      ...env,
    },
    stdio: 'pipe',
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));

  function send(cmd) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('命令超时: ' + cmd.cmd)), 20000);
      pending.set(id, (m) => {
        clearTimeout(t);
        m.error ? reject(new Error(m.error)) : resolve(m.value);
      });
      const full = { ...cmd, id };
      const w = waiters.shift();
      w ? w(full) : queue.push(full);
    });
  }

  async function stop() {
    send({ cmd: 'quit' }).catch(() => {}); // app.exit 不会回包,故意不 await
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    child.kill('SIGKILL');
    if (ownsUserData) fs.rmSync(dir, { recursive: true, force: true });
    server.close();
  }

  return { send, stop, events, exited, getLog: () => log, userData: dir };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll until fn() is truthy (or time out).
export async function until(fn, ms = 20000, step = 100) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > ms) return null;
    await sleep(step);
  }
}
