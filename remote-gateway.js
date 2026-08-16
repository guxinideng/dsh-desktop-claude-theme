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
//   DSH_TRUSTED_HOSTS  comma-separated host:port authorities passed to dsh's
//                   own --trusted-host flag, so its /api browser-trust fence
//                   accepts requests proxied through this gateway (unset =
//                   none passed; dsh then only trusts its own address, and
//                   every proxied request 403s since the browser's Origin
//                   never matches 127.0.0.1:<DSH_PORT>)
//   IDLE_MINUTES    idle time with no open connections before     (default 30)
//                   dsh is stopped
//   GATEWAY_TOKEN   shared secret required to use the gateway —
//                   visit once as ?token=<value>, the gateway sets
//                   a cookie so the page's own requests (including
//                   the WebSocket) stay authorized after that.
//                   Unset = no auth; only safe on a trusted network.
//   TLS_CERT_FILE   PEM cert (with TLS_KEY_FILE) to serve HTTPS instead of
//   TLS_KEY_FILE    plain HTTP — required for real phone browsers to work at
//                   all off a bare IP: they treat plain-http non-loopback
//                   origins as an insecure context and disable crypto.subtle
//                   / crypto.randomUUID, which dsh's own frontend calls, and
//                   they attach stricter Fetch-Metadata (Sec-Fetch-Site) to
//                   requests that trip dsh's browser-trust fence. Both unset
//                   = plain HTTP, fine for a loopback-only tunnel.
//
// Usage: npm install && npm run gateway

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const httpProxy = require('http-proxy');
const { spawn } = require('child_process');

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT) || 3090;
const DSH_PORT = Number(process.env.DSH_PORT) || 3080;
const DSH_BIN = process.env.DSH_BIN || 'dsh';
const DSH_TRUSTED_HOSTS = (process.env.DSH_TRUSTED_HOSTS || '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);
const IDLE_MS = (Number(process.env.IDLE_MINUTES) || 30) * 60 * 1000;
const TOKEN = process.env.GATEWAY_TOKEN || null;
const TLS_OPTS =
  process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE
    ? { cert: fs.readFileSync(process.env.TLS_CERT_FILE), key: fs.readFileSync(process.env.TLS_KEY_FILE) }
    : null;

// STT_MODEL_FILE  path to a ggml whisper.cpp model (default: bundled
//                 whisper-models/ggml-large-v3-turbo-q5_0.bin next to this
//                 file — see docs/superpowers/plans/2026-08-16-voice-to-text-composer.md)
// STT_WHISPER_BIN whisper.cpp CLI binary                       (default "whisper-cli")
// STT_TIMEOUT_MS  max time allowed for ffmpeg + whisper-cli     (default 30000)
const STT_MODEL_FILE =
  process.env.STT_MODEL_FILE || path.join(__dirname, 'whisper-models', 'ggml-large-v3-turbo-q5_0.bin');
const STT_WHISPER_BIN = process.env.STT_WHISPER_BIN || 'whisper-cli';
const STT_TIMEOUT_MS = Number(process.env.STT_TIMEOUT_MS) || 30000;
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
  const args = ['web', '--port', String(DSH_PORT)];
  for (const host of DSH_TRUSTED_HOSTS) args.push('--trusted-host', host);
  console.log(`[gateway] starting dsh: ${DSH_BIN} ${args.join(' ')}`);
  const child = spawn(DSH_BIN, args, { stdio: 'pipe' });
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

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function runCommand(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Local speech-to-text: audio in, transcribed text out — see
// docs/superpowers/specs/2026-08-16-voice-to-text-composer-design.md for
// why this runs on the Mac (whisper.cpp + Metal) instead of a cloud API
// or the VPS (1 core / 1GB RAM, can't run a real STT model).
async function handleStt(req, res) {
  const id = crypto.randomUUID();
  const inputPath = path.join(os.tmpdir(), `dsh-stt-${id}.input`);
  const wavPath = path.join(os.tmpdir(), `dsh-stt-${id}.wav`);
  const outBase = path.join(os.tmpdir(), `dsh-stt-${id}`);
  const txtPath = `${outBase}.txt`;

  try {
    const audio = await readRequestBody(req);
    if (audio.length === 0) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'empty audio' }));
      return;
    }
    fs.writeFileSync(inputPath, audio);

    await runCommand('ffmpeg', ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', wavPath], STT_TIMEOUT_MS);
    await runCommand(
      STT_WHISPER_BIN,
      ['-m', STT_MODEL_FILE, '-f', wavPath, '-l', 'zh', '-nt', '-np', '-otxt', '-of', outBase],
      STT_TIMEOUT_MS
    );

    const text = fs.readFileSync(txtPath, 'utf8').trim();
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ text }));
  } catch (err) {
    console.error('[gateway] stt error:', err.message);
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'stt failed' }));
  } finally {
    for (const p of [inputPath, wavPath, txtPath]) {
      fs.unlink(p, () => {});
    }
  }
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

// changeOrigin is deliberately left off: dsh's own /api browser-trust fence
// requires the Host header it sees to match the browser's Origin (see
// @deepseek-ai/dsh-client-connection's isTrustedApiRequest) — rewriting Host
// to the backend's own address (what changeOrigin does) would desync it from
// the untouched Origin header and get every proxied request 403'd. Passing
// the original inbound Host straight through keeps the two in sync, and
// DSH_TRUSTED_HOSTS is what gets that Host authorized in the first place.
const proxy = httpProxy.createProxyServer({ target: DSH_URL });
proxy.on('error', (err, req, res) => {
  console.error('[gateway] proxy error:', err.message);
  if (res && !res.headersSent && typeof res.writeHead === 'function') {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('dsh 暂时不可用，请稍后重试');
  } else if (res && typeof res.destroy === 'function') {
    res.destroy();
  }
});

// Theme/mobile assets and the index-HTML injection that references them —
// see theme.css and mobile.css/mobile.js for what these actually change.
// This is the only response body the gateway ever rewrites; every other
// route (JS/CSS bundles, /api, WebSocket) stays a byte-for-byte proxy.
const THEME_ASSETS = {
  '/__ds_theme/theme.css': { file: path.join(__dirname, 'theme.css'), type: 'text/css; charset=utf-8' },
  '/__ds_theme/mobile.css': { file: path.join(__dirname, 'mobile.css'), type: 'text/css; charset=utf-8' },
  '/__ds_theme/mobile.js': { file: path.join(__dirname, 'mobile.js'), type: 'application/javascript; charset=utf-8' },
};

function serveThemeAsset(pathname, res) {
  const asset = THEME_ASSETS[pathname];
  res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-cache' });
  res.end(fs.readFileSync(asset.file, 'utf8'));
}

// main.js injects theme.css into the Electron window at runtime via
// webContents.insertCSS — there's no webContents here, so this does the
// browser-side equivalent by fetching dsh's own index HTML and splicing in
// <link>/<script> tags before proxying it to the client.
function serveThemedIndex(req, res) {
  const upstream = http.get(DSH_URL + req.url, (dshRes) => {
    const chunks = [];
    dshRes.on('data', (chunk) => chunks.push(chunk));
    dshRes.on('end', () => {
      let body = Buffer.concat(chunks).toString('utf8');
      body = body
        // Pinch-zoom fights the drawer's own swipe gestures more than it
        // helps on a chat UI that already reflows its own text size — this
        // only takes effect on mobile's narrow-viewport rendering, desktop
        // browsers ignore user-scalable entirely.
        .replace(
          '<meta name="viewport" content="width=device-width, initial-scale=1" />',
          '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />'
        )
        .replace(
          '</head>',
          '<link rel="stylesheet" href="/__ds_theme/theme.css">\n' +
            '<link rel="stylesheet" href="/__ds_theme/mobile.css">\n' +
            '</head>'
        )
        .replace('</body>', '<script src="/__ds_theme/mobile.js"></script>\n</body>');
      // dsh serves this chunked (no content-length at all) — carrying that
      // header forward while also setting content-length below leaves both
      // present, which is an invalid combination (RFC 7230 §3.3.3) that had
      // the client hang partway through the page load, unsure which one to
      // trust for where the body ends.
      const headers = { ...dshRes.headers, 'content-length': Buffer.byteLength(body) };
      delete headers['content-encoding'];
      delete headers['transfer-encoding'];
      res.writeHead(dshRes.statusCode, headers);
      res.end(body);
    });
  });
  upstream.on('error', (err) => {
    console.error('[gateway] index fetch error:', err.message);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('dsh 暂时不可用，请稍后重试');
  });
}

const requestHandler = async (req, res) => {
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

  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname in THEME_ASSETS) {
    serveThemeAsset(pathname, res);
    return;
  }

  if (pathname === '/__ds_theme/stt' && req.method === 'POST') {
    touch();
    await handleStt(req, res);
    return;
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

  if (pathname === '/') {
    serveThemedIndex(req, res);
    return;
  }

  proxy.web(req, res);
};

const server = TLS_OPTS ? https.createServer(TLS_OPTS, requestHandler) : http.createServer(requestHandler);

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
    `[gateway] listening on ${TLS_OPTS ? 'https' : 'http'}://127.0.0.1:${GATEWAY_PORT}, proxying to dsh on ${DSH_PORT}, ` +
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
