#!/usr/bin/env node
'use strict';

// remote-gateway.js
//
// A small always-on proxy to put in front of `dsh web` so a phone (via a
// tunnel such as Tailscale or Cloudflare Tunnel pointed at this process)
// can reach dsh without dsh itself needing to run 24/7. On the first
// request after being idle it spawns `dsh web`, waits for it to answer,
// and proxies the request through (HTTP and WebSocket alike); once there
// are no open connections and no traffic for a while, it stops the dsh
// process it started — never one it didn't start.
//
// This does not touch dsh itself and does not replace the Electron app —
// it's a separate, optional entry point for the "reach it from my phone"
// case. main.js keeps working exactly as before.
//
// Config is via environment variables (all optional):
//   GATEWAY_PORT    port this process listens on                (default 3090)
//   DSH_PORT        port dsh itself binds to                     (default 3080)
//   DSH_BIN         command used to launch dsh                   (default "dsh")
//   IDLE_MINUTES    idle time with no open connections before     (default 30)
//                   dsh is stopped
//   GATEWAY_TOKEN   shared secret required to use the gateway —
//                   visit once as ?token=<value>, the gateway sets
//                   a cookie so the page's own requests (including
//                   the WebSocket) stay authorized after that.
//                   Unset = no auth; only safe on a trusted network.
//
// Usage: npm install && npm run gateway

const http = require('http');
const httpProxy = require('http-proxy');
const { spawn } = require('child_process');

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT) || 3090;
const DSH_PORT = Number(process.env.DSH_PORT) || 3080;
const DSH_BIN = process.env.DSH_BIN || 'dsh';
const IDLE_MS = (Number(process.env.IDLE_MINUTES) || 30) * 60 * 1000;
const TOKEN = process.env.GATEWAY_TOKEN || null;
const DSH_URL = `http://127.0.0.1:${DSH_PORT}`;
const COOKIE_NAME = 'dsh_gateway_token';
// However long IDLE_MS is, poll for it at a matching cadence — capped to
// [5s, 60s] so a short test window doesn't wait a full idle check cycle.
const CHECK_INTERVAL_MS = Math.max(5000, Math.min(60000, IDLE_MS / 4));

if (!TOKEN) {
  console.warn(
    '[gateway] GATEWAY_TOKEN 未设置——任何能连到这个端口的人都能直接操作 dsh。' +
      '只在受信任的网络(比如自己的 Tailscale tailnet)里这样用；' +
      '一旦隧道更公开，先设置 GATEWAY_TOKEN 再暴露出去。'
  );
}

// Mobile connections vanish without a clean FIN (lock screen, dead signal,
// wifi->cellular handoff) far more often than desktop ones — a socket stuck
// in openConnections with no traffic for this long is assumed dead and is
// force-closed, so one abandoned tab can't block the idle shutdown forever.
const STALE_SOCKET_MS = 5 * 60 * 1000;

let dshChild = null; // only set if THIS process spawned dsh
let starting = null; // in-flight "ensure dsh is up" promise, shared across concurrent requests
let lastActivityAt = Date.now();
const openConnections = new Set(); // long-lived res/socket objects currently in flight

function touch() {
  lastActivityAt = Date.now();
}

function pingDsh(timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(DSH_URL, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function spawnDsh() {
  console.log(`[gateway] starting dsh: ${DSH_BIN} web --port ${DSH_PORT}`);
  const child = spawn(DSH_BIN, ['web', '--port', String(DSH_PORT)], { stdio: 'pipe' });
  child.stdout.on('data', (d) => process.stdout.write(`[dsh] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[dsh] ${d}`));
  child.on('exit', (code) => {
    console.log(`[gateway] dsh exited (code ${code})`);
    if (dshChild === child) dshChild = null;
  });
  child.on('error', (err) => {
    console.error(`[gateway] failed to start dsh: ${err.message}`);
    if (dshChild === child) dshChild = null;
  });
  return child;
}

// Ensures dsh is reachable, spawning it at most once even if several
// requests arrive during the same cold start.
async function ensureDshReady() {
  if (await pingDsh(800)) return;
  if (starting) return starting;

  starting = (async () => {
    if (!(await pingDsh(500))) {
      dshChild = spawnDsh();
    }
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await pingDsh(700)) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('dsh 启动超时');
  })();

  try {
    await starting;
  } finally {
    starting = null;
  }
}

function killIdleDsh() {
  if (!dshChild) return;
  if (openConnections.size > 0) return;
  if (Date.now() - lastActivityAt < IDLE_MS) return;

  console.log('[gateway] idle timeout reached, stopping dsh');
  const child = dshChild;
  dshChild = null;
  child.kill('SIGTERM');
  setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }, 5000).unref();
}

setInterval(killIdleDsh, CHECK_INTERVAL_MS).unref();

function getCookie(req, name) {
  const header = req.headers['cookie'];
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

// Returns 'header' | 'cookie' | 'query' | null. 'query' is the one case the
// caller needs to react to (by setting the cookie) — header/cookie are
// already durable across requests.
function authMethod(req) {
  if (!TOKEN) return 'none';
  const header = req.headers['authorization'] || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (bearer === TOKEN) return 'header';
  if (getCookie(req, COOKIE_NAME) === TOKEN) return 'cookie';
  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.get('token') === TOKEN) return 'query';
  return null;
}

const proxy = httpProxy.createProxyServer({ target: DSH_URL, changeOrigin: true });
proxy.on('error', (err, req, res) => {
  console.error('[gateway] proxy error:', err.message);
  if (res && !res.headersSent && typeof res.writeHead === 'function') {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('dsh 暂时不可用，请稍后重试');
  } else if (res && typeof res.destroy === 'function') {
    res.destroy();
  }
});

const server = http.createServer(async (req, res) => {
  const auth = authMethod(req);
  if (auth === null) {
    res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('unauthorized');
    return;
  }
  if (auth === 'query') {
    // First visit with ?token=... — remember it so the page's own asset/API
    // requests (which won't carry the query string) stay authorized too.
    res.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=${TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
    );
  }

  touch();
  openConnections.add(res);
  req.socket.setTimeout(STALE_SOCKET_MS, () => req.socket.destroy());
  res.on('close', () => {
    openConnections.delete(res);
    touch();
  });

  try {
    await ensureDshReady();
  } catch {
    openConnections.delete(res);
    res.writeHead(504, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('dsh 启动超时，请重试');
    return;
  }

  proxy.web(req, res);
});

server.on('upgrade', async (req, socket, head) => {
  // The page only opens a WebSocket after its initial HTML load already
  // set the cookie above, so upgrades just need to read it back — never
  // set-cookie here, a raw socket has no clean way to carry response headers.
  if (authMethod(req) === null) {
    socket.destroy();
    return;
  }

  touch();
  openConnections.add(socket);
  socket.on('close', () => {
    openConnections.delete(socket);
    touch();
  });

  try {
    await ensureDshReady();
  } catch {
    socket.destroy();
    return;
  }

  proxy.ws(req, socket, head);
  // http-proxy's own setup resets the socket timeout to 0 (disabled) as
  // part of wiring up the pipe — set ours after, so it isn't clobbered.
  socket.setTimeout(STALE_SOCKET_MS, () => socket.destroy());
});

server.listen(GATEWAY_PORT, '127.0.0.1', () => {
  console.log(
    `[gateway] listening on 127.0.0.1:${GATEWAY_PORT}, proxying to dsh on ${DSH_PORT}, ` +
      `idle timeout ${(IDLE_MS / 60000).toFixed(1)} min${TOKEN ? '' : ', auth DISABLED'}`
  );
  console.log('[gateway] point your tunnel (Tailscale/Cloudflare/etc.) at this port, not at dsh directly.');
});

function shutdown() {
  console.log('[gateway] shutting down');
  if (dshChild) dshChild.kill('SIGTERM');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
