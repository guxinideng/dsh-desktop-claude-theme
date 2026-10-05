// dsh 0.2.x 登录令牌(?token= → cookie)兼容逻辑的验证脚本。不需要真实 dsh、不碰 3080、不弹真对话框/不碰剪贴板。
//
//   node scripts/test-electron-login.mjs
//
// 用一个假 dsh(行为照 0.2.0-rc.2 的 browser-auth:没 cookie 一律 401;带正确 ?token= 访问 / → 303 + Set-Cookie)
// 验证 main.js:
//   A 壳自己拉起 dsh:从它启动输出里取令牌自动登录,日志里令牌被打码
//   B 外部已在跑的 dsh、本机还没 cookie:弹提示,从“剪贴板”取令牌后登录
//   C 剪贴板里是别的来源的地址:绝不跟随,三次后退出(窗口从不打开)
//   D 再次启动(同一 userData):cookie 已记住,不再提示
//   E 0.1.x 式无鉴权 dsh:完全不受影响
// 需要先 `npm ci`。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { launchHarness, until } from './electron-test-driver.mjs';

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `   <- ${detail}`}`);
  if (!ok) failed++;
}

const TOKEN = 'T' + Math.random().toString(36).slice(2).padEnd(24, 'x');
const FAKE_DSH = `
const http = require('http');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const token = process.env.FAKE_TOKEN;
const open = process.env.FAKE_NOAUTH === '1';
const authed = (req) => open || (req.headers.cookie || '').includes('dsh-auth-fake=ok');
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (!open && u.pathname === '/' && u.searchParams.get('token') === token) {
    res.writeHead(303, { location: './', 'set-cookie': 'dsh-auth-fake=ok; Path=/; HttpOnly; Max-Age=86400' });
    return res.end();
  }
  if (!authed(req)) return res.writeHead(401, { 'content-type': 'text/plain' }).end('authentication required; reopen the URL printed by dsh web.');
  res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>fake dsh</title><body>OK</body>');
}).listen(port, '127.0.0.1', () => console.log('dsh web: http://127.0.0.1:' + port + '/' + (open ? '' : '?token=' + token)));
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-login-test-'));
const fakePath = path.join(tmp, 'fake-dsh.js');
fs.writeFileSync(fakePath, FAKE_DSH);
const children = [];
function runFake(port, extraEnv = {}) {
  const c = spawn(process.execPath, [fakePath, 'web', '--port', String(port)], { env: { ...process.env, FAKE_TOKEN: TOKEN, ...extraEnv }, stdio: 'ignore' });
  children.push(c);
  return new Promise((r) => setTimeout(r, 400));
}
const bodyOf = (h) => h.send({ cmd: 'eval', code: 'document.body.innerText' }).catch(() => null);
const gotOK = (h) => until(async () => (await bodyOf(h)) === 'OK', 15000);
const count = (h, type) => h.events.filter((e) => e.type === type).length;

try {
  // A:壳自己拉起(假 dsh 放进 userData/dsh-vendor,main.js 的 vendoredDshBin 会找到它)
  {
    const h = await launchHarness({
      dshPort: 3291,
      env: { FAKE_TOKEN: TOKEN },
      setup: (dir) => {
        const bin = path.join(dir, 'dsh-vendor/node_modules/@deepseek-ai/dsh/lib');
        fs.mkdirSync(bin, { recursive: true });
        fs.writeFileSync(path.join(bin, 'bin.js'), FAKE_DSH);
      },
    });
    check('A 壳自己拉起 dsh:自动带令牌登录,页面正常', !!(await gotOK(h)), (await bodyOf(h)) + h.getLog().slice(-300));
    check('A 不需要弹提示', count(h, 'messageBox') === 0);
    check('A 地址栏最终是不带令牌的干净地址', (await h.send({ cmd: 'status' })).url === 'http://127.0.0.1:3291/');
    check('A 日志里令牌已打码', h.getLog().includes('token=…') && !h.getLog().includes(TOKEN));
    await h.stop();
  }

  // B + D:外部 dsh,首次需要令牌,再次启动不用
  await runFake(3292);
  {
    const ud = fs.mkdtempSync(path.join(tmp, 'ud-'));
    const h = await launchHarness({ dshPort: 3292, userData: ud, env: { HARNESS_CLIPBOARD: `复制来的一行 http://127.0.0.1:3292/?token=${TOKEN} 结尾` } });
    check('B 外部 dsh 首次:弹出提示并从剪贴板取令牌后登录', !!(await gotOK(h)) && count(h, 'messageBox') === 1, `body=${await bodyOf(h)} boxes=${count(h, 'messageBox')}`);
    await h.stop();
    const h2 = await launchHarness({ dshPort: 3292, userData: ud });
    check('D 再次启动:cookie 已记住,不再提示、页面正常', !!(await gotOK(h2)) && count(h2, 'messageBox') === 0, `body=${await bodyOf(h2)} boxes=${count(h2, 'messageBox')}`);
    await h2.stop();
  }

  // C:剪贴板是别的来源 → 不跟随
  {
    const h = await launchHarness({ dshPort: 3292, env: { HARNESS_CLIPBOARD: `http://evil.test:3292/?token=${TOKEN}` } });
    const code = await Promise.race([h.exited, new Promise((r) => setTimeout(() => r('timeout'), 15000))]);
    check('C 别的来源的令牌地址被忽略:提示三次后退出,没有打开任何窗口', code === 0 && count(h, 'messageBox') === 3 && count(h, 'openExternal') === 0, `exit=${code} boxes=${count(h, 'messageBox')}`);
    await h.stop();
  }

  // E:0.1.x 式无鉴权
  await runFake(3293, { FAKE_NOAUTH: '1' });
  {
    const h = await launchHarness({ dshPort: 3293 });
    check('E 无鉴权的旧版 dsh:照常打开,不提示', !!(await gotOK(h)) && count(h, 'messageBox') === 0, `body=${await bodyOf(h)}`);
    await h.stop();
  }
} catch (e) {
  console.error('测试脚本自身出错:', e);
  failed++;
} finally {
  children.forEach((c) => c.kill('SIGKILL'));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
