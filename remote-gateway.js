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
const zlib = require('zlib');
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
// Raised from 30s: whisper.cpp transcribes longer recordings slower than
// short ones, and a multi-sentence hold used to blow the 30s budget and
// fail the whole request (paired with the client's 20s abort in mobile.js,
// both since raised to 60s).
const STT_TIMEOUT_MS = Number(process.env.STT_TIMEOUT_MS) || 60000;
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

// Standalone/home-screen mode has no address bar and no back button — a
// bare text/plain error line used to be a dead end, only escapable by
// force-quitting and reopening the app. Styled page with an obvious retry
// button instead, in every gateway-level failure response below.
function renderErrorPage(heading, detail) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${heading}</title></head>
<body style="margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
background:#FAF9F5;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;
padding:24px;padding-top:calc(24px + env(safe-area-inset-top));
padding-bottom:calc(24px + env(safe-area-inset-bottom));box-sizing:border-box;">
<div style="max-width:300px;text-align:center;">
<div style="font-size:16px;color:#28241f;line-height:1.6;margin-bottom:10px;">${heading}</div>
<div style="font-size:13px;color:#8a8574;line-height:1.6;margin-bottom:24px;">${detail}</div>
<button onclick="location.reload()" style="background:#28241f;color:#fff;border:none;
border-radius:999px;padding:12px 36px;font-size:15px;-webkit-appearance:none;cursor:pointer;">重试</button>
</div>
</body></html>`;
}

// Cold-start waking page: shown instead of blocking the request for up to
// 30s inside ensureDshReady(). A blank tab with no browser chrome (no
// progress bar, no address bar) gives no sign anything is happening during
// that wait — this gives feedback immediately, then polls in the
// background and reloads once dsh answers. Marked with the
// data-ds-waking-page attribute the poll below checks for: once a poll
// response no longer carries it, dsh is up and this reloads for real.
function renderWakingPage() {
  return `<!doctype html>
<html data-ds-waking-page="1"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>正在唤醒</title></head>
<body style="margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
background:#FAF9F5;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;
padding:24px;padding-top:calc(24px + env(safe-area-inset-top));
padding-bottom:calc(24px + env(safe-area-inset-bottom));box-sizing:border-box;">
<div style="max-width:300px;text-align:center;">
<div style="width:28px;height:28px;margin:0 auto 16px;border-radius:999px;border:3px solid #EDE9DF;
border-top-color:#28241f;animation:ds-wake-spin 0.9s linear infinite;"></div>
<div id="ds-wake-status" style="font-size:15px;color:#28241f;line-height:1.6;margin-bottom:6px;">正在唤醒 dsh…</div>
<div style="font-size:13px;color:#8a8574;line-height:1.6;">通常 10-30 秒内完成,好了会自动跳转</div>
<button id="ds-wake-retry" onclick="location.reload()" style="display:none;margin-top:20px;
background:#28241f;color:#fff;border:none;border-radius:999px;padding:12px 36px;font-size:15px;
-webkit-appearance:none;cursor:pointer;">重试</button>
</div>
<style>@keyframes ds-wake-spin{to{transform:rotate(360deg)}}</style>
<script>
(function () {
  var attempts = 0;
  var maxAttempts = 20; // 20 * 1.5s = 30s, matching the gateway's own startup budget
  function poll() {
    attempts++;
    fetch(location.pathname + location.search, { cache: 'no-store' })
      .then(function (res) { return res.text(); })
      .then(function (text) {
        if (text.indexOf('data-ds-waking-page') === -1) {
          location.reload();
          return;
        }
        if (attempts >= maxAttempts) {
          document.getElementById('ds-wake-status').textContent = '还没准备好';
          document.getElementById('ds-wake-retry').style.display = 'inline-block';
        } else {
          setTimeout(poll, 1500);
        }
      })
      .catch(function () {
        if (attempts < maxAttempts) setTimeout(poll, 1500);
      });
  }
  setTimeout(poll, 1500);
})();
</script>
</body></html>`;
}

// changeOrigin is deliberately left off: dsh's own /api browser-trust fence
// requires the Host header it sees to match the browser's Origin (see
// @deepseek-ai/dsh-client-connection's isTrustedApiRequest) — rewriting Host
// to the backend's own address (what changeOrigin does) would desync it from
// the untouched Origin header and get every proxied request 403'd. Passing
// the original inbound Host straight through keeps the two in sync, and
// DSH_TRUSTED_HOSTS is what gets that Host authorized in the first place.
const proxy = httpProxy.createProxyServer({ target: DSH_URL, selfHandleResponse: true });

// Compress large text responses on the way out. dsh serves them
// uncompressed — measured, /api/session.history for a long conversation
// is 6.66MB with a transfer/decoded ratio of exactly 1.000 — and the
// phone's path to it is Mac -> SSH tunnel -> VPS -> phone. nginx on the
// VPS gzips its own leg, but by then the full 6.66MB has already gone up
// the tunnel over a home connection's upload, which is the slow link in
// the chain and the reason opening a long conversation drags.
//
// Scoped by content type only. Gating on a content-length threshold was
// the first attempt and compressed nothing at all: dsh sends every API
// response chunked, so there is no length to test and the condition was
// never true.
//
// Streaming is handled by Z_SYNC_FLUSH instead. dsh streams the model's
// output as chunked JSON — the same shape as the bulk responses, so it
// can't be told apart by headers — and a default gzip stream would sit
// on those tokens until its buffer filled, turning live output into
// bursts. Z_SYNC_FLUSH emits a complete flush point per chunk, so each
// one reaches the phone as it arrives. It costs some ratio (each chunk
// compresses on its own), which is a fair trade here: the win is not
// having to choose between compression and streaming.
//
// SSE is excluded outright — text/event-stream has no reason to be
// compressed and is the one place where any added buffering is
// immediately visible. WebSocket upgrades never reach this handler.
const COMPRESSIBLE_TYPE = /application\/(json|javascript)|text\/|\+json/i;

proxy.on('proxyRes', (proxyRes, req, res) => {
  const headers = { ...proxyRes.headers };
  const type = headers['content-type'] || '';
  const acceptsGzip = /\bgzip\b/i.test(req.headers['accept-encoding'] || '');
  const shouldCompress =
    acceptsGzip &&
    !headers['content-encoding'] &&
    COMPRESSIBLE_TYPE.test(type) &&
    !/text\/event-stream/i.test(type);

  if (!shouldCompress) {
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
    return;
  }

  // Length changes once compressed, and stating the old one would
  // truncate the body at the client.
  delete headers['content-length'];
  headers['content-encoding'] = 'gzip';
  headers['vary'] = headers['vary'] ? `${headers['vary']}, Accept-Encoding` : 'Accept-Encoding';
  res.writeHead(proxyRes.statusCode, headers);

  const gzip = zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH });
  gzip.on('error', () => res.destroy());
  proxyRes.pipe(gzip).pipe(res);
});

proxy.on('error', (err, req, res) => {
  console.error('[gateway] proxy error:', err.message);
  if (res && !res.headersSent && typeof res.writeHead === 'function') {
    res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderErrorPage('连接中断', 'dsh 暂时不可用，可能刚好在重启，通常重试就能恢复。'));
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
  // Reuses the Electron app's own packaged icon (build/AppIcon.iconset) —
  // already exists, already the project's actual mark, no new asset
  // generated just to fill this in. 256x256 comfortably covers iOS's
  // largest apple-touch-icon use (iPad Pro at 167x167); binary:true skips
  // the utf8 read below, which would otherwise corrupt the PNG bytes.
  '/__ds_theme/apple-touch-icon.png': {
    file: path.join(__dirname, 'build', 'AppIcon.iconset', 'icon_256x256.png'),
    type: 'image/png',
    binary: true,
  },
};

// mobile.js/mobile.css are 90KB+ combined; a synchronous read blocks the
// entire single-threaded event loop for its duration — including any
// WebSocket traffic and STT uploads in flight at that moment, not just
// other HTTP requests. Cached by mtime so a plain reload doesn't pay a
// disk read at all, while still picking up an edited file on its very
// next request (the mtime check is itself async, so even that is off
// the event loop).
const themeAssetCache = new Map(); // pathname -> { mtimeMs, content }

async function serveThemeAsset(pathname, res) {
  const asset = THEME_ASSETS[pathname];
  const cacheControl = asset.binary ? 'public, max-age=86400' : 'no-cache';
  try {
    const stat = await fs.promises.stat(asset.file);
    const cached = themeAssetCache.get(pathname);
    let content;
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      content = cached.content;
    } else {
      content = await fs.promises.readFile(asset.file, asset.binary ? undefined : 'utf8');
      themeAssetCache.set(pathname, { mtimeMs: stat.mtimeMs, content });
    }
    res.writeHead(200, { 'content-type': asset.type, 'cache-control': cacheControl });
    res.end(content);
  } catch (err) {
    console.error('[gateway] theme asset read error:', err.message);
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('asset read error');
  }
}

// main.js injects theme.css into the Electron window at runtime via
// webContents.insertCSS — there's no webContents here, so this does the
// browser-side equivalent by fetching dsh's own index HTML and splicing in
// <link>/<script> tags before proxying it to the client.
function serveThemedIndex(req, res) {
  // Cache-busting stamp for the injected theme assets: the standalone
  // ("添加到主屏幕") mode on iOS caches aggressively, and no-cache headers
  // were still letting the phone run a stale mobile.js (user kept
  // reporting fixes that "至始至终没有生效" — the code was fine, the
  // phone never loaded it). URL ?v=<mtime> changes exactly when a file
  // changes, forcing a fresh fetch then and only then.
  const themeStamp = (() => {
    try {
      const t = fs.statSync(path.join(__dirname, 'mobile.css')).mtimeMs;
      const j = fs.statSync(path.join(__dirname, 'mobile.js')).mtimeMs;
      return Math.max(t, j).toString(36);
    } catch {
      return '1';
    }
  })();
  const upstream = http.get(DSH_URL + req.url, (dshRes) => {
    const chunks = [];
    dshRes.on('data', (chunk) => chunks.push(chunk));
    dshRes.on('end', () => {
      let body = Buffer.concat(chunks).toString('utf8');

      // dsh is plugin-based: window.__DSH_BOOT__ at the top of <head>
      // lists every client plugin with its full versioned URL, but they
      // are fetched by the core bundle, so nothing starts downloading
      // them until that bundle has itself downloaded, parsed and run.
      // Measured on a session load: core at 56ms, first plugins at 88ms,
      // the large UI ones (conversation 417KB, trajectory 351KB) not
      // until ~370ms — a serial stall that is most of the wait before
      // anything renders.
      //
      // The URLs are already in the markup, so preload links let the
      // browser start all of them while it is still parsing <head>,
      // in parallel with the core bundle instead of after it. Parsed
      // out of the boot payload rather than hardcoded: each URL carries
      // a ?rev= hash that changes per dsh build, and a stale list would
      // silently double-fetch. Preload is a hint — a URL that no longer
      // matches costs one wasted request and nothing else.
      const pluginPreloads = (() => {
        const urls = [...body.matchAll(/"url":"(\/plugins\/[^"]+)"/g)].map((m) => m[1]);
        if (!urls.length) return '';
        // No crossorigin attribute: a preload is only reused if it matches
        // the real request, and dsh loads these same-origin plugins with a
        // plain <script src>. Adding it made every plugin download twice —
        // 38 requests became 75 — which is worse than not preloading at all.
        return (
          [...new Set(urls)].map((u) => `<link rel="preload" as="script" href="${u}">`).join('\n') + '\n'
        );
      })();

      body = body
        // Pinch-zoom fights the drawer's own swipe gestures more than it
        // helps on a chat UI that already reflows its own text size — this
        // only takes effect on mobile's narrow-viewport rendering, desktop
        // browsers ignore user-scalable entirely. viewport-fit=cover lets
        // the page paint behind the notch / Dynamic Island — without it
        // iOS fills that safe-area strip with the browser's own white,
        // which stayed white on screen even when the app was in dark mode
        // (the stray light block beside the island). With cover, the
        // page's own background reaches the edge and mobile.css's
        // safe-area paddings keep content out from under the island.
        .replace(
          '<meta name="viewport" content="width=device-width, initial-scale=1" />',
          '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no" />'
        )
        .replace(
          '</head>',
          // iOS reads its own apple-* tags for "added to home screen" mode
          // (manifest support came later and is more limited) — none of
          // these existed before, so a saved icon had no capable/title/
          // status-bar declarations to go on at all.
          //
          // theme-color: a full per-device launch-image set (the
          // traditional apple-touch-startup-image approach) needs a
          // separate PNG for every iPhone/iPad screen size and
          // orientation — a couple dozen images generated and maintained
          // for a cosmetic transition. Not doing that. What this gets
          // for near-zero cost instead: iOS building its own transition
          // out of the apple-touch-icon (already added above) centered
          // on this color when there's no explicit launch image. Same
          // #FAF9F5 as the skeleton and the rest of the app, so if it
          // does render, it hands off to the skeleton without a visible
          // seam. Whether iOS actually renders this couldn't be checked
          // here — it only shows launching from a real home-screen icon,
          // which needs a physical device.
          // Preloads go first: they only help to the extent the browser
          // sees them early, and everything below is either a meta tag
          // or a stylesheet the parser handles regardless of order.
          pluginPreloads +
            '<meta name="theme-color" content="#FAF9F5">\n' +
            '<meta name="apple-mobile-web-app-capable" content="yes">\n' +
            '<meta name="apple-mobile-web-app-status-bar-style" content="default">\n' +
            '<meta name="apple-mobile-web-app-title" content="DeepSeek">\n' +
            `<link rel="apple-touch-icon" href="/__ds_theme/apple-touch-icon.png?v=${themeStamp}">\n` +
            // color-scheme tells the browser this page renders light, so the
            // canvas it paints before any of our CSS applies is light too
            // rather than following the phone's dark system setting.
            '<meta name="color-scheme" content="light">\n' +
            `<link rel="stylesheet" href="/__ds_theme/theme.css?v=${themeStamp}">\n` +
            `<link rel="stylesheet" href="/__ds_theme/mobile.css?v=${themeStamp}">\n` +
            // Strip dsh's dark flag the instant it appears, inline and in
            // <head> — mobile.js does this too, but it loads at </body>,
            // long after dsh's own bundle has already set the attribute and
            // painted a frame with it. mobile.css covers five
            // --dsw-alias-bg-* variables for that window, but dsh flips 39
            // of them: the composer card reads its fill from
            // --dsw-alias-button-elevated-fill (dark value rgb(38,36,34)),
            // which is the black slab that flashed over the new-session
            // screen on a dark-mode phone before turning light. Chasing the
            // remaining 34 variables would just re-break whenever dsh adds
            // one, so this removes the trigger instead of repainting its
            // effects. Two observers: the first waits for <body> to exist
            // (it does not yet, at this point in the parse), then hands off
            // to one watching only that single attribute — cheap enough to
            // leave running for the life of the page.
            '<script>(function(){function s(){var b=document.body;' +
            "if(b&&b.hasAttribute('data-ds-dark-theme'))b.removeAttribute('data-ds-dark-theme');}" +
            'function w(){s();new MutationObserver(s).observe(document.body,' +
            "{attributes:true,attributeFilter:['data-ds-dark-theme']});}" +
            'if(document.body){w();}else{var m=new MutationObserver(function(){' +
            'if(document.body){m.disconnect();w();}});' +
            'm.observe(document.documentElement,{childList:true,subtree:true});}})();</script>\n' +
            '</head>'
        )
        .replace('</body>', `<script src="/__ds_theme/mobile.js?v=${themeStamp}"></script>\n</body>`)
        // dsh's mount point arrives empty — nothing paints until the SPA's
        // JS bundles (vendor + index, ~1.2MB combined) download, parse,
        // execute, and React renders: measured ~2.7s of blank white
        // before first paint on this connection. Standalone/home-screen
        // mode has no browser chrome (no progress bar, no address bar)
        // to signal that anything is happening in that window, so a
        // static skeleton goes here instead. Inlined (not from
        // mobile.css) so it's already paintable in the same response,
        // before any stylesheet has had a chance to load; React's own
        // render replaces these children wholesale on mount, so this
        // needs no cleanup logic of its own.
        .replace(
          '<div id="root"></div>',
          '<div id="root"><div style="position:fixed;inset:0;background:#FAF9F5;' +
            'display:flex;flex-direction:column;">' +
            '<div style="flex:0 0 auto;height:52px;padding-top:env(safe-area-inset-top);' +
            'display:flex;align-items:center;padding-left:16px;box-sizing:content-box;">' +
            '<div style="width:96px;height:16px;border-radius:4px;background:#EDE9DF;' +
            'animation:ds-boot-pulse 1.6s ease-in-out infinite;"></div>' +
            '</div>' +
            '<div style="flex:1 1 auto;"></div>' +
            '<div style="flex:0 0 auto;padding:12px 16px calc(12px + env(safe-area-inset-bottom));">' +
            '<div style="height:52px;border-radius:16px;background:#EDE9DF;' +
            'animation:ds-boot-pulse 1.6s ease-in-out infinite;"></div>' +
            '</div>' +
            '</div>' +
            '<style>@keyframes ds-boot-pulse{0%,100%{opacity:.6}50%{opacity:1}}</style>' +
            '</div>'
        );
      // dsh serves this chunked (no content-length at all) — carrying that
      // header forward while also setting content-length below leaves both
      // present, which is an invalid combination (RFC 7230 §3.3.3) that had
      // the client hang partway through the page load, unsure which one to
      // trust for where the body ends.
      const headers = { ...dshRes.headers, 'content-length': Buffer.byteLength(body) };
      delete headers['content-encoding'];
      delete headers['transfer-encoding'];
      // The injected index carries our viewport/theme edits, so it must
      // never be served from a stale cache — dsh sends no cache-control
      // of its own, and without one the browser's heuristic caching kept
      // serving the pre-viewport-fit HTML no matter how often the page
      // was refreshed (the island stayed light even after the fix). Pin
      // it to no-store so every load re-fetches the rewritten index.
      headers['cache-control'] = 'no-store';
      res.writeHead(dshRes.statusCode, headers);
      res.end(body);
    });
  });
  upstream.on('error', (err) => {
    console.error('[gateway] index fetch error:', err.message);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderErrorPage('连接中断', 'dsh 暂时不可用，可能刚好在重启，通常重试就能恢复。'));
  });
}

// dsh's own manifest declares display:"fullscreen", which hides the
// status bar (clock/battery/signal) — a real loss for a chat tool the
// user dips in and out of all day; standalone is the normal choice for
// an app like this. (A user screenshot showed the status bar visible
// regardless, suggesting iOS may already be treating it as standalone —
// this is mostly about making the declared config match actual behavior,
// not fixing a visibly broken one.) JSON.parse/stringify rather than a
// text replace so this doesn't depend on dsh's exact formatting.
function serveManifest(req, res) {
  const upstream = http.get(DSH_URL + req.url, (dshRes) => {
    const chunks = [];
    dshRes.on('data', (chunk) => chunks.push(chunk));
    dshRes.on('end', () => {
      let body = Buffer.concat(chunks).toString('utf8');
      try {
        const manifest = JSON.parse(body);
        if (manifest.display === 'fullscreen') manifest.display = 'standalone';
        // Same #FAF9F5 as the theme-color meta tag in the injected index
        // HTML and the first-paint skeleton — Android's manifest-driven
        // splash (better-supported there than on iOS) uses these two
        // fields for its own equivalent transition.
        manifest.background_color = '#FAF9F5';
        manifest.theme_color = '#FAF9F5';
        body = JSON.stringify(manifest, null, 2);
      } catch (err) {
        console.error('[gateway] manifest parse error:', err.message);
        // fall through and proxy dsh's original bytes unmodified
      }
      const headers = { ...dshRes.headers, 'content-length': Buffer.byteLength(body) };
      delete headers['content-encoding'];
      delete headers['transfer-encoding'];
      res.writeHead(dshRes.statusCode, headers);
      res.end(body);
    });
  });
  upstream.on('error', (err) => {
    console.error('[gateway] manifest fetch error:', err.message);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end('{}');
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
    await serveThemeAsset(pathname, res);
    return;
  }

  if (pathname === '/__ds_theme/stt' && req.method === 'POST') {
    touch();
    await handleStt(req, res);
    return;
  }

  // Cold-start waking page: only for top-level navigations (what the
  // phone's home-screen icon opens) — API calls, WebSocket upgrades, and
  // asset requests must never get this page, they need dsh's own response
  // (or the existing timeout/error handling below) to behave correctly.
  // A quick 500ms probe decides whether dsh is already up; if not, this
  // returns immediately instead of blocking on the full 30s
  // ensureDshReady() wait, and kicks that off in the background (not
  // awaited — its rejection is caught and ignored here; the page's own
  // poll, see renderWakingPage, is what surfaces eventual failure to the
  // user) so dsh is warming up while the page checks back every 1.5s.
  const isNavigation = pathname === '/' && req.method === 'GET' && (req.headers.accept || '').includes('text/html');
  if (isNavigation && !(await pingDsh(500))) {
    touch();
    ensureDshReady().catch(() => {});
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderWakingPage());
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
    res.writeHead(504, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderErrorPage('启动超时', 'dsh 尝试启动但超过 30 秒没有响应，可能是首次启动较慢，或者遇到了问题。'));
    return;
  }

  if (pathname === '/') {
    serveThemedIndex(req, res);
    return;
  }

  if (pathname === '/manifest.webmanifest') {
    serveManifest(req, res);
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
