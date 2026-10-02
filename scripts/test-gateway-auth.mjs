// remote-gateway.js 鉴权加固的最小验证脚本(不依赖真实 dsh,不碰正式网关)。
//
//   node scripts/test-gateway-auth.mjs
//
// 在临时端口(3190/3191)起测试用网关 + 一个假的 dsh 后端(3181),用随机
// 测试 token,逐条断言:常量时间比较之外的行为层面——Bearer/Cookie/Query
// 三种凭据、query→cookie 并 302 去掉 token、旧书签兼容、WebSocket 升级鉴权、
// 失败限速、无 token 时拒绝"经隧道转发来的"请求、畸形 cookie 不会让进程崩溃。
// 测完自动关掉所有子进程。

import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = crypto.randomBytes(16).toString('hex');
const GW = 3190;
const GW_NOTOKEN = 3191;
const STUB = 3181;

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `   <- ${detail}`}`);
  if (!ok) failed++;
}

// 假 dsh:/ 返回最小 HTML(网关会往里注入主题),其余返回 ok,支持 WS 升级。
const stub = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><head></head><body><div id="root"></div></body></html>');
  } else {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  }
});
stub.on('upgrade', (req, socket) => {
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
});
await new Promise((r) => stub.listen(STUB, '127.0.0.1', r));

function startGateway(port, token) {
  const env = { ...process.env, GATEWAY_PORT: String(port), DSH_PORT: String(STUB), DSH_BIN: '/nonexistent-dsh' };
  delete env.GATEWAY_TOKEN;
  if (token) env.GATEWAY_TOKEN = token;
  const child = spawn(process.execPath, [path.join(ROOT, 'remote-gateway.js')], { env, stdio: 'pipe', cwd: ROOT });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  child.getLog = () => log;
  return child;
}
const gw = startGateway(GW, TOKEN);
const gwOpen = startGateway(GW_NOTOKEN, null);

function req(port, { method = 'GET', url = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: url, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    r.on('error', reject);
    r.end();
  });
}
// WS 升级:返回 'upgraded' | 'rejected'(连接被直接断开/没给 101)
function wsUpgrade(port, headers = {}) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => {
      const h = Object.entries({ Host: `127.0.0.1:${port}`, Upgrade: 'websocket', Connection: 'Upgrade',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13', ...headers })
        .map(([k, v]) => `${k}: ${v}`).join('\r\n');
      s.write(`GET /ws HTTP/1.1\r\n${h}\r\n\r\n`);
    });
    let buf = '';
    s.on('data', (d) => { buf += d; if (buf.includes('\r\n\r\n')) { s.destroy(); resolve(buf.startsWith('HTTP/1.1 101') ? 'upgraded' : 'rejected'); } });
    s.on('close', () => resolve('rejected'));
    s.on('error', () => resolve('rejected'));
    setTimeout(() => { s.destroy(); resolve('rejected'); }, 4000);
  });
}
const HTML = { accept: 'text/html' };
const cookieOf = (res) => (res.headers['set-cookie'] || [])[0] || '';

// 等网关起来
for (let i = 0; i < 50; i++) {
  try { await req(GW, {}); await req(GW_NOTOKEN, {}); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
}

try {
  // ── 基本凭据 ──
  let r = await req(GW, { headers: { accept: 'application/json' } });
  check('无凭据 → 401', r.status === 401, r.status);
  r = await req(GW, { url: '/api/x', headers: { authorization: `Bearer ${TOKEN}` } });
  check('Bearer 正确 → 200', r.status === 200, r.status);
  r = await req(GW, { url: '/api/x', headers: { authorization: 'Bearer wrong' } });
  check('Bearer 错误 → 401', r.status === 401, r.status);
  r = await req(GW, { url: '/api/x', headers: { cookie: `dsh_gateway_token=${TOKEN}` } });
  check('Cookie 正确 → 200', r.status === 200, r.status);
  r = await req(GW, { url: '/api/x', headers: { cookie: `dsh_gateway_token=${TOKEN.slice(0, -1)}x` } });
  check('Cookie 仅末位不同 → 401', r.status === 401, r.status);
  r = await req(GW, { url: `/api/x?token=${TOKEN.slice(0, 8)}` });
  check('Query 前缀 → 401', r.status === 401, r.status);

  // ── query → cookie → 302 去 token(旧书签兼容)──
  r = await req(GW, { url: `/?token=${TOKEN}`, headers: HTML });
  const ck = cookieOf(r);
  check('书签 /?token=… 导航 → 302', r.status === 302, r.status);
  check('302 的 Location 已不含 token', r.headers.location === '/', r.headers.location);
  check('Set-Cookie 带 HttpOnly + SameSite=Lax', /HttpOnly/i.test(ck) && /SameSite=Lax/i.test(ck), ck.replace(TOKEN, '<T>'));
  check('明文 http 下不加 Secure(否则 Safari 不存)', !/Secure/i.test(ck), ck.replace(TOKEN, '<T>'));
  r = await req(GW, { url: '/', headers: { ...HTML, cookie: ck.split(';')[0] } });
  check('带 cookie 跟随重定向后 → 200 且注入了 mobile.js', r.status === 200 && r.body.includes('/__ds_theme/mobile.js'), r.status);
  r = await req(GW, { url: `/?token=${TOKEN}&foo=1`, headers: HTML });
  check('其它 query 参数被保留', r.headers.location === '/?foo=1', r.headers.location);
  r = await req(GW, { url: `/api/x?token=${TOKEN}`, headers: { accept: 'application/json' } });
  check('脚本请求(非导航)带 query token → 200 不重定向', r.status === 200 && cookieOf(r).includes('dsh_gateway_token'), r.status);
  r = await req(GW, { url: '/?token=stale-old-token', headers: { ...HTML, cookie: `dsh_gateway_token=${TOKEN}` } });
  check('cookie 有效 + 书签带过期 token → 302 清掉', r.status === 302 && r.headers.location === '/', `${r.status} ${r.headers.location}`);
  check('响应里不回显 token', !JSON.stringify(r.headers).includes(TOKEN) && !r.body.includes(TOKEN));

  // ── WebSocket 升级同样鉴权 ──
  check('WS 无凭据 → 拒绝', (await wsUpgrade(GW)) === 'rejected');
  check('WS 带 cookie → 升级成功', (await wsUpgrade(GW, { Cookie: `dsh_gateway_token=${TOKEN}` })) === 'upgraded');

  // ── 畸形 cookie 不能让进程崩(原先 decodeURIComponent 抛 URIError)──
  r = await req(GW, { url: '/api/x', headers: { cookie: 'dsh_gateway_token=%E0%A4%A' } });
  check('畸形 cookie(HTTP) → 401 而非崩溃', r.status === 401, r.status);
  check('畸形 cookie(WS 升级) → 拒绝而非崩溃', (await wsUpgrade(GW, { Cookie: 'dsh_gateway_token=%E0%A4%A' })) === 'rejected');
  r = await req(GW, { url: '/api/x', headers: { authorization: `Bearer ${TOKEN}` } });
  check('以上之后网关仍然存活', r.status === 200, r.status);

  // ── 失败限速(按 X-Real-IP,即 nginx 看到的客户端地址)──
  const evil = { 'x-real-ip': '203.0.113.9' };
  for (let i = 0; i < 20; i++) await req(GW, { url: '/api/x', headers: { ...evil, authorization: 'Bearer nope' } });
  r = await req(GW, { url: '/api/x', headers: { ...evil, authorization: 'Bearer nope' } });
  check('连续失败 20 次后 → 429', r.status === 429, r.status);
  check('429 带 Retry-After', !!r.headers['retry-after'], JSON.stringify(r.headers));
  r = await req(GW, { url: '/api/x', headers: { ...evil, authorization: `Bearer ${TOKEN}` } });
  check('被封地址即使凭据正确也 → 429', r.status === 429, r.status);
  check('被封地址的 WS 升级 → 拒绝', (await wsUpgrade(GW, { ...evil, Cookie: `dsh_gateway_token=${TOKEN}` })) === 'rejected');
  r = await req(GW, { url: '/api/x', headers: { 'x-real-ip': '198.51.100.7', authorization: `Bearer ${TOKEN}` } });
  check('别的地址不受牵连 → 200', r.status === 200, r.status);

  // ── 未设置 token:只认真正的本机,经隧道转发来的远程请求一律拒绝 ──
  r = await req(GW_NOTOKEN, { url: '/api/x' });
  check('无 token 模式:本机直连 → 200(保持本地开发体验)', r.status === 200, r.status);
  r = await req(GW_NOTOKEN, { url: '/api/x', headers: { 'x-real-ip': '203.0.113.9' } });
  check('无 token 模式:X-Real-IP 为外网地址 → 401', r.status === 401, r.status);
  r = await req(GW_NOTOKEN, { url: '/api/x', headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } });
  check('无 token 模式:X-Forwarded-For 为外网地址 → 401', r.status === 401, r.status);
  check('无 token 模式:远程来源的 WS 升级 → 拒绝', (await wsUpgrade(GW_NOTOKEN, { 'X-Real-IP': '203.0.113.9' })) === 'rejected');
  check('无 token 模式:本机 WS 升级 → 成功', (await wsUpgrade(GW_NOTOKEN)) === 'upgraded');

  // ── 日志里不能出现 token ──
  check('网关日志不含 token', !gw.getLog().includes(TOKEN));
} catch (e) {
  console.error('测试脚本自身出错:', e);
  failed++;
} finally {
  gw.kill('SIGTERM');
  gwOpen.kill('SIGTERM');
  stub.close();
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
}
