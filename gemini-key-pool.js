#!/usr/bin/env node
'use strict';

// gemini-key-pool.js — a local stand-in for generativelanguage.googleapis.com
// that holds several API keys and moves to the next one when the current key
// runs out of quota.
//
// Why this exists at all: dsh cannot hold two Google accounts. A second route
// (`google-2`) would not be a catalog route, and a non-catalog route must
// declare `api` — but llm-pi-ai's PROTOCOLS table only carries
// openai-completions, openai-responses and anthropic-messages. Google is
// absent, so the second route can never start. The one field that does leave
// room is `baseURL`: point the existing google route here, and the account
// question stops being dsh's problem.
//
//   llm-pi-ai:
//     providers:
//       google:
//         baseURL: http://127.0.0.1:3099
//
// dsh still sends its own x-goog-api-key; this strips it and substitutes a key
// from the pool, so the value dsh holds is irrelevant (leave the existing one).
//
// Usage:
//   node gemini-key-pool.js add [label]   add a key at a hidden prompt
//   node gemini-key-pool.js import        adopt the key modlens already has
//   node gemini-key-pool.js list          show keys, masked, with state
//   node gemini-key-pool.js rm <n>        remove key number n
//   node gemini-key-pool.js serve         run the proxy (default port 3099)

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');

const STORE = path.join(os.homedir(), '.dsh', 'gemini-keys.json');
const PORT = Number(process.env.KEY_POOL_PORT || 3099);

// Overridable so the rotation can be exercised against a stub that returns 429
// on demand — the real thing only does that once an account is actually spent,
// which is not something a test can arrange. Set KEY_POOL_UPSTREAM_INSECURE=1
// alongside it to speak plain HTTP to a local stub.
const UPSTREAM = process.env.KEY_POOL_UPSTREAM || 'generativelanguage.googleapis.com';
const UPSTREAM_INSECURE = process.env.KEY_POOL_UPSTREAM_INSECURE === '1';

// Google reports both a spent minute-quota and a spent day-quota as 429, and
// the body distinguishes them only loosely. Rather than parse that, a key that
// answers 429 is set aside for a while and the request moves on: a minute
// limit heals well inside the window, and a day limit simply keeps re-arming
// it, which costs one wasted request per window rather than a wrong guess.
const COOLDOWN_MS = Number(process.env.KEY_POOL_COOLDOWN_MS || 90_000);

// ── store ──────────────────────────────────────────────────────────────────

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    return Array.isArray(parsed.keys) ? parsed : { keys: [] };
  } catch {
    return { keys: [] };
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  // Written 0600 before anything lands in it: creating the file first and
  // chmod-ing after would leave the keys world-readable for that instant.
  const fd = fs.openSync(STORE, 'w', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(data, null, 2) + '\n');
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(STORE, 0o600);
}

function mask(key) {
  if (key.length <= 12) return '****';
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

// ── CLI ────────────────────────────────────────────────────────────────────

// Reads one line without echoing it, so the key stays out of the terminal
// scrollback. Piped input is accepted too (`pbpaste | … add`), which is the
// same shape modlens uses and keeps the value out of argv either way.
function readSecret(promptText) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => (buf += c));
      process.stdin.on('end', () => resolve(buf.split('\n')[0].trim()));
      process.stdin.on('error', reject);
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(promptText);
    const onData = (char) => {
      // Re-print the prompt with nothing after it, so keystrokes leave no trace.
      if (!/[\r\n]/.test(String(char))) readline.cursorTo(process.stdout, promptText.length);
    };
    process.stdin.on('data', onData);
    rl.question('', (answer) => {
      process.stdin.off('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function cmdAdd(label) {
  const key = await readSecret('粘贴 API key(输入不回显): ');
  if (!key) {
    console.error('没有读到内容,未改动。');
    process.exit(1);
  }
  const data = load();
  if (data.keys.some((k) => k.key === key)) {
    console.error('这把 key 已经在池子里了,未重复添加。');
    process.exit(1);
  }
  data.keys.push({
    label: label || `账号 ${data.keys.length + 1}`,
    key,
    cooldownUntil: 0,
    requests: 0,
    exhausted: 0,
  });
  save(data);
  console.log(`已添加 ${data.keys[data.keys.length - 1].label} (${mask(key)}),池中共 ${data.keys.length} 把。`);
}

// modlens 早就配过一把 key,再从 AI Studio 复制一遍只是多一次经手、
// 多一次暴露机会。这条命令在两个本地文件之间搬,值不打印也不进 argv。
async function cmdImport() {
  const src = path.join(os.homedir(), '.modlens', 'config.json');
  let key;
  try {
    const cfg = JSON.parse(fs.readFileSync(src, 'utf8'));
    key = cfg?.providers?.['gemini-api']?.apiKey || cfg?.providers?.gemini?.apiKey;
  } catch {
    console.error(`读不到 ${src}`);
    process.exit(1);
  }
  if (!key) {
    console.error(`${src} 里没有 gemini key。`);
    process.exit(1);
  }
  const data = load();
  if (data.keys.some((k) => k.key === key)) {
    console.log(`modlens 那把 (${mask(key)}) 已经在池子里了,没重复添加。`);
    return;
  }
  data.keys.push({
    label: 'modlens 导入',
    key,
    cooldownUntil: 0,
    requests: 0,
    exhausted: 0,
  });
  save(data);
  console.log(`已从 modlens 导入 (${mask(key)}),池中共 ${data.keys.length} 把。`);
}

function cmdList() {
  const data = load();
  if (!data.keys.length) {
    console.log(`池子是空的。用 "node ${path.basename(__filename)} add" 添加。`);
    return;
  }
  const now = Date.now();
  console.log(`存储: ${STORE}\n`);
  data.keys.forEach((k, i) => {
    const cooling = k.cooldownUntil > now;
    const state = cooling ? `冷却中(${Math.ceil((k.cooldownUntil - now) / 1000)}s)` : '可用';
    console.log(
      `  ${i + 1}. ${k.label}  ${mask(k.key)}  ${state}  已用 ${k.requests} 次  额度耗尽 ${k.exhausted} 次`
    );
  });
}

function cmdRemove(n) {
  const data = load();
  const idx = Number(n) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= data.keys.length) {
    console.error(`序号无效。当前池中 ${data.keys.length} 把,用 list 查看。`);
    process.exit(1);
  }
  const [gone] = data.keys.splice(idx, 1);
  save(data);
  console.log(`已移除 ${gone.label} (${mask(gone.key)}),剩 ${data.keys.length} 把。`);
}

// ── proxy ──────────────────────────────────────────────────────────────────

/** Keys that are not cooling down, least recently used first. */
function available(data) {
  const now = Date.now();
  return data.keys
    .map((k, i) => ({ k, i }))
    .filter(({ k }) => k.cooldownUntil <= now)
    .sort((a, b) => a.k.requests - b.k.requests);
}

function forward({ req, body, key }) {
  return new Promise((resolve, reject) => {
    const headers = { ...req.headers };
    // dsh sends whatever key its credentials hold; the pool decides instead.
    delete headers['x-goog-api-key'];
    delete headers['X-Goog-Api-Key'];
    headers['x-goog-api-key'] = key;
    delete headers['content-length'];
    if (body.length) headers['content-length'] = String(body.length);

    const [upstreamHost, upstreamPort] = UPSTREAM.split(':');
    // The host header must name the upstream, not this proxy: Google's edge
    // answers 404 for a host it does not serve.
    headers.host = upstreamHost;
    const transport = UPSTREAM_INSECURE ? http : https;
    const upstream = transport.request(
      {
        hostname: upstreamHost,
        port: Number(upstreamPort) || (UPSTREAM_INSECURE ? 80 : 443),
        path: req.url,
        method: req.method,
        headers,
      },
      (res) => resolve(res)
    );
    upstream.on('error', reject);
    if (body.length) upstream.write(body);
    upstream.end();
  });
}

function serve() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      // Buffered rather than piped: a retry on the next key has to replay the
      // same body, and a consumed stream cannot be replayed.
      const body = Buffer.concat(chunks);
      const data = load();
      const pool = available(data);

      if (!pool.length) {
        const total = data.keys.length;
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              code: 429,
              status: 'RESOURCE_EXHAUSTED',
              message: total
                ? `本地 key 池里 ${total} 把 key 全部在冷却中,稍后重试或添加更多账号。`
                : '本地 key 池是空的,先用 gemini-key-pool.js add 添加。',
            },
          })
        );
        return;
      }

      let lastStatus = 502;
      for (const { k, i } of pool) {
        let upstreamRes;
        try {
          upstreamRes = await forward({ req, body, key: k.key });
        } catch (error) {
          // A transport failure says nothing about this key's quota, so it
          // does not earn a cooldown — the next key simply gets a turn.
          console.error(`[key-pool] ${k.label} 转发失败: ${error.message}`);
          lastStatus = 502;
          continue;
        }

        const quotaSpent = upstreamRes.statusCode === 429;
        if (quotaSpent) {
          upstreamRes.resume(); // drain, or the socket stays open
          const fresh = load();
          if (fresh.keys[i]) {
            fresh.keys[i].cooldownUntil = Date.now() + COOLDOWN_MS;
            fresh.keys[i].exhausted += 1;
            save(fresh);
          }
          console.error(`[key-pool] ${k.label} 额度耗尽,冷却 ${COOLDOWN_MS / 1000}s,换下一把`);
          lastStatus = 429;
          continue;
        }

        const fresh = load();
        if (fresh.keys[i]) {
          fresh.keys[i].requests += 1;
          save(fresh);
        }
        // Everything else — including 4xx that are the caller's fault — goes
        // back untouched. Piped, not buffered: dsh renders the model's tokens
        // as they arrive, and holding them would turn streaming into a wait.
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        upstreamRes.pipe(res);
        return;
      }

      res.writeHead(lastStatus, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            code: lastStatus,
            status: lastStatus === 429 ? 'RESOURCE_EXHAUSTED' : 'UNAVAILABLE',
            message: `池中 ${pool.length} 把 key 都试过了,均未成功。`,
          },
        })
      );
    });
  });

  server.listen(PORT, '127.0.0.1', () => {
    const n = load().keys.length;
    console.log(`[key-pool] 监听 http://127.0.0.1:${PORT} → ${UPSTREAM}`);
    console.log(`[key-pool] 池中 ${n} 把 key,冷却 ${COOLDOWN_MS / 1000}s`);
    console.log('[key-pool] 把 dsh 的 google route 配成 baseURL: http://127.0.0.1:' + PORT);
  });
}

// ── entry ──────────────────────────────────────────────────────────────────

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case 'add':
    cmdAdd(arg);
    break;
  case 'import':
    cmdImport();
    break;
  case 'list':
    cmdList();
    break;
  case 'rm':
  case 'remove':
    cmdRemove(arg);
    break;
  case 'serve':
    serve();
    break;
  default:
    console.log(
      [
        'gemini-key-pool — 多账号 Gemini key 池,额度耗尽自动换下一个',
        '',
        `  node ${path.basename(__filename)} add [名字]   添加一把 key(隐藏输入)`,
        `  node ${path.basename(__filename)} import       把 modlens 已配的那把搬进来`,
        `  node ${path.basename(__filename)} list         查看池中的 key(已遮蔽)`,
        `  node ${path.basename(__filename)} rm <序号>    移除一把`,
        `  node ${path.basename(__filename)} serve        启动代理(默认 ${PORT} 端口)`,
        '',
        `存储位置: ${STORE} (0600)`,
      ].join('\n')
    );
}
