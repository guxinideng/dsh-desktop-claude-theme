// Electron 壳安全加固(main.js / preload.js)的验证脚本。不依赖真实 dsh,不碰 3080 上正在跑的实例,
// 不会真的打开浏览器或文件对话框。
//
//   node scripts/test-electron-security.mjs
//
// 做法:在临时端口起一个假的 dsh 页面服务,让真实的 main.js 通过 scripts/electron-test-harness.cjs
// 启动(只替换 shell.openExternal / dialog.showOpenDialog 为记录用桩、userData 用临时目录、窗口全透明),
// 页面里的脚本在真实渲染进程里跑断言,结果回传给本脚本。覆盖:
//   隔离(无 require/process、桥只暴露 pickFiles)、window.open / location 跳转 / 重定向 只放行 http(s) 到系统浏览器、
//   主窗口始终留在 dsh、pick-files IPC 对非 dsh 来源返回 []、权限请求只对 dsh 放行、CSP 头、
//   dshfont 协议对畸形/穿越路径不崩、跨源子框架拿不到桥、主题注入仍然生效。
// 需要先 `npm ci`(要有 node_modules/electron/dist)。

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_PORT = 3281; // 假 dsh
const FOREIGN = `http://localhost:${PAGE_PORT}`; // 与 127.0.0.1 同端口但属于另一个 origin
const FONT = fs.readdirSync(path.join(ROOT, 'fonts')).find((f) => f.endsWith('.woff2'));

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `   <- ${detail}`}`);
  if (!ok) failed++;
}

// ── 页面里跑的测试(渲染进程,主世界) ──
const P1 = `
(async () => {
  const out = {};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  out.hasRequire = typeof window.require;
  out.hasProcess = typeof window.process;
  out.hasModule = typeof window.module;
  out.bridgeKeys = Object.keys(window.dshDesktop || {});
  out.picked = await window.dshDesktop.pickFiles();
  await wait(600); // 等 dom-ready 后的主题注入
  out.themeVar = getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim();
  // CSP 只加在主文档上、读不到响应头,所以验证它的效果:<base> 注入应被 base-uri 拦下
  out.cspViolation = await new Promise((resolve) => {
    document.addEventListener('securitypolicyviolation', (e) => resolve(e.violatedDirective), { once: true });
    const b = document.createElement('base');
    b.href = 'https://evil.test/';
    document.head.appendChild(b);
    setTimeout(() => resolve('none'), 1000);
  });
  out.baseURI = document.baseURI;
  out.notification = await Notification.requestPermission();
  const font = await fetch('dshfont://f/${FONT}');
  out.fontStatus = font.status;
  out.fontBytes = (await font.arrayBuffer()).byteLength;
  out.fontTraversal = (await fetch('dshfont://f/..%2f..%2fpackage.json')).status;
  out.fontMalformed = (await fetch('dshfont://f/%E0%A4%A')).status;
  out.fontMissing = (await fetch('dshfont://f/nope.woff2')).status;
  // 跨源子框架:预加载脚本不进子框架,桥不该存在
  const frameResult = new Promise((resolve) => {
    addEventListener('message', (e) => { if (e.data && e.data.frameBridge !== undefined) resolve(e.data.frameBridge); });
  });
  const f = document.createElement('iframe');
  f.src = '${FOREIGN}/p3';
  document.body.appendChild(f);
  out.frameBridge = await Promise.race([frameResult, wait(3000).then(() => 'timeout')]);
  // 各种"想离开 dsh"的方式
  const before = location.href;
  window.open('https://example.com/open');
  window.open('file:///etc/hosts');
  window.open('dshfont://f/x');
  window.open('javascript:alert(1)');
  location.href = 'https://example.net/nav';
  await wait(300);
  location.href = 'file:///etc/hosts';
  await wait(300);
  location.href = 'vscode://settings';
  await wait(300);
  location.href = '/redir'; // 本站 302 到外站:will-redirect 要拦住
  await wait(800);
  out.stayed = location.href === before;
  fetch('/__result', { method: 'POST', body: JSON.stringify({ phase: 1, out }) });
})();
`;

const P2 = `
(async () => {
  const out = { origin: location.origin };
  out.hasBridge = !!window.dshDesktop;
  out.picked = await window.dshDesktop.pickFiles();
  out.notification = await Notification.requestPermission();
  fetch('/__result', { method: 'POST', body: JSON.stringify({ phase: 2, out }) });
})();
`;

const P3 = `<script>parent.postMessage({ frameBridge: typeof window.dshDesktop }, '*');</script>`;

// ── 假 dsh + 控制通道 ──
const events = []; // harness 上报:openExternal / dialog
const results = {};
const waiters = [];
const cmdQueue = [];
const cmdWaiters = [];
let cmdSeq = 0;
const pending = new Map();

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => resolve(b));
  });
}
function page(script) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>${script}</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];
  if (pathname === '/__cmd') {
    const next = cmdQueue.shift();
    if (next) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(next));
    const waiter = (c) => {
      clearTimeout(t);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(c));
    };
    const t = setTimeout(() => {
      cmdWaiters.splice(cmdWaiters.indexOf(waiter), 1);
      res.writeHead(204).end();
    }, 1500);
    cmdWaiters.push(waiter);
    return;
  }
  if (pathname === '/__main') {
    const msg = JSON.parse(await readBody(req));
    if (msg.type === 'result') pending.get(msg.id)?.(msg);
    else events.push(msg);
    return res.writeHead(204).end();
  }
  if (pathname === '/__result') {
    const { phase, out } = JSON.parse(await readBody(req));
    results[phase] = out;
    waiters.splice(0).forEach((w) => w());
    return res.writeHead(204).end();
  }
  if (pathname === '/redir') return res.writeHead(302, { location: 'https://example.org/redirected' }).end();
  if (pathname === '/p3') return res.writeHead(200, { 'content-type': 'text/html' }).end(P3);
  if (pathname === '/p2') return res.writeHead(200, { 'content-type': 'text/html' }).end(page(P2));
  res.writeHead(200, { 'content-type': 'text/html' }).end(page(P1));
});
await new Promise((r) => server.listen(PAGE_PORT, '127.0.0.1', r));

function send(cmd) {
  const id = ++cmdSeq;
  const full = { ...cmd, id };
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('命令超时: ' + cmd.cmd)), 20000);
    pending.set(id, (m) => {
      clearTimeout(t);
      m.error ? reject(new Error(m.error)) : resolve(m.value);
    });
    const w = cmdWaiters.shift();
    w ? w(full) : cmdQueue.push(full);
  });
}
const waitFor = (phase, ms = 20000) =>
  new Promise((resolve, reject) => {
    if (results[phase]) return resolve();
    const t = setTimeout(() => reject(new Error(`等待第 ${phase} 阶段结果超时`)), ms);
    waiters.push(() => {
      clearTimeout(t);
      resolve();
    });
  });

// ── 启动真实 main.js ──
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-electron-test-'));
const electronBin = (await import('node:module')).createRequire(import.meta.url)(path.join(ROOT, 'node_modules/electron'));
const child = spawn(electronBin, [path.join(ROOT, 'scripts/electron-test-harness.cjs')], {
  env: {
    ...process.env,
    DSH_DESKTOP_PORT: String(PAGE_PORT),
    HARNESS_CTRL: `http://127.0.0.1:${PAGE_PORT}`,
    HARNESS_USER_DATA: userData,
  },
  stdio: 'pipe',
});
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));
child.on('exit', (code) => {
  if (!finished) {
    console.error('Electron 提前退出,代码', code, '\n', log.slice(-1500));
    process.exit(1);
  }
});
let finished = false;

try {
  await waitFor(1);
  const r1 = results[1];
  const ext = events.filter((e) => e.type === 'openExternal').map((e) => e.url);

  check('隔离:渲染进程里没有 require / process / module', r1.hasRequire === 'undefined' && r1.hasProcess === 'undefined' && r1.hasModule === 'undefined', JSON.stringify([r1.hasRequire, r1.hasProcess, r1.hasModule]));
  check('桥只暴露 pickFiles 一个方法', JSON.stringify(r1.bridgeKeys) === '["pickFiles"]', JSON.stringify(r1.bridgeKeys));
  check('dsh 主框架调用 pickFiles → 拿到(桩)路径', JSON.stringify(r1.picked) === '["/tmp/dsh harness/picked file.txt"]', JSON.stringify(r1.picked));
  check('主题 CSS 仍被注入(--dsw-alias-bg-base)', r1.themeVar === 'rgb(250, 249, 245)', r1.themeVar);
  check('对 dsh 主文档追加的 CSP 生效:注入 <base> 被 base-uri 拦下', /^base-uri/.test(r1.cspViolation) && r1.baseURI.startsWith('http://127.0.0.1:'), `${r1.cspViolation} / ${r1.baseURI}`);
  check('dsh 来源的权限请求仍放行(Notification → granted)', r1.notification === 'granted', r1.notification);
  check('dshfont 正常字体 200 且非空', r1.fontStatus === 200 && r1.fontBytes > 1000, `${r1.fontStatus}/${r1.fontBytes}`);
  check('dshfont 路径穿越不返回内容', r1.fontTraversal !== 200, r1.fontTraversal);
  check('dshfont 畸形百分号编码 → 400(以前会抛异常)', r1.fontMalformed === 400, r1.fontMalformed);
  check('dshfont 不存在的文件 → 404 而不是网络错误', r1.fontMissing === 404, r1.fontMissing);
  check('跨源子框架里没有 dshDesktop 桥', r1.frameBridge === 'undefined', String(r1.frameBridge));
  check('window.open / 跳转:只有 http(s) 交给系统浏览器', JSON.stringify([...ext].sort()) === JSON.stringify(['https://example.com/open', 'https://example.net/nav', 'https://example.org/redirected']), JSON.stringify(ext));
  check('file: / dshfont: / javascript: / vscode: 一律没有交给 openExternal', !ext.some((u) => !/^https?:/.test(u)), JSON.stringify(ext));
  check('主窗口始终留在 dsh 页面', r1.stayed === true);
  const st = await send({ cmd: 'status' });
  check('没有多开窗口', st.windows === 1, JSON.stringify(st));

  // 阶段 2:把窗口导航到别的 origin(桥仍会随预加载进来),pick-files 必须拒绝
  await send({ cmd: 'loadURL', url: `${FOREIGN}/p2` });
  await waitFor(2);
  const r2 = results[2];
  check('(阶段2)页面确实在非 dsh origin 上', r2.origin === FOREIGN, r2.origin);
  check('非 dsh 来源调用 pickFiles → 空数组,且没有弹出对话框', r2.hasBridge && JSON.stringify(r2.picked) === '[]' && events.filter((e) => e.type === 'dialog').length === 1, JSON.stringify([r2.picked, events.filter((e) => e.type === 'dialog').length]));
  check('非 dsh 来源的权限请求被拒(Notification → denied)', r2.notification === 'denied', r2.notification);
} catch (e) {
  console.error('测试脚本自身出错:', e, '\n--- electron 输出 ---\n', log.slice(-1500));
  failed++;
} finally {
  finished = true;
  send({ cmd: 'quit' }).catch(() => {}); // app.exit 不会回包,故意不 await
  setTimeout(() => {
    child.kill('SIGKILL');
    fs.rmSync(userData, { recursive: true, force: true });
    server.close();
    process.exit(failed ? 1 : 0);
  }, 500);
}
