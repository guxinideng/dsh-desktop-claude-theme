const { app, BrowserWindow, protocol, net, dialog, ipcMain, shell } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { listArchivedIds, unarchive, deleteSessions, isPortListening } = require('./archive-manager');

const DSH_PORT = 3080;
const DSH_URL = `http://127.0.0.1:${DSH_PORT}`;
const DSH_HOME = path.join(os.homedir(), '.dsh');

const THEME_CSS = fs.readFileSync(path.join(__dirname, 'theme.css'), 'utf8');
// Only bundled in the Windows build's files list (see electron-builder.windows.yml)
// — reading it unconditionally crashes the mac builds at startup with ENOENT,
// since their asar never contains this file at all.
const WINDOWS_OVERRIDES_CSS =
  process.platform === 'win32' ? fs.readFileSync(path.join(__dirname, 'windows-overrides.css'), 'utf8') : '';
const LABEL_TWEAKS_JS = fs.readFileSync(path.join(__dirname, 'label-tweaks.js'), 'utf8');
const TRACE_COLLAPSE_JS = fs.readFileSync(path.join(__dirname, 'trace-collapse.js'), 'utf8');
const TRACE_TRANSLATE_JS = fs.readFileSync(path.join(__dirname, 'trace-translate.js'), 'utf8');
const FONT_PICKER_JS = fs.readFileSync(path.join(__dirname, 'font-picker.js'), 'utf8');
const ICONS_JS = fs.readFileSync(path.join(__dirname, 'icons.js'), 'utf8');
const BATCH_SELECT_JS = fs.readFileSync(path.join(__dirname, 'batch-select.js'), 'utf8');
const FILE_PICKER_JS = fs.readFileSync(path.join(__dirname, 'file-picker.js'), 'utf8');
const APPROVAL_HOTKEY_JS = fs.readFileSync(path.join(__dirname, 'approval-hotkey.js'), 'utf8');
// Optional: the archived-sessions page. A build or checkout without the file
// still starts; the page just isn't injected.
let ARCHIVED_PAGE_JS = '';
try {
  ARCHIVED_PAGE_JS = fs.readFileSync(path.join(__dirname, 'archived-page.js'), 'utf8');
} catch (err) {
  console.warn(`[archived-page] 未注入 archived-page.js：${err.code || err.message}`);
}

// Shown immediately on launch, before dsh is confirmed reachable — spawning
// the Windows build's own copy (see installLatestDsh below) means a real
// npm install, which can run well past what feels instant. Without this a
// first-time recipient gets a blank/frozen-looking window for however long
// that takes. Inline (no separate file) since it never needs the dshfont://
// protocol or any of the theme JS — it's off-screen again as soon as the
// real window is ready.
const LOADING_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { margin:0; height:100vh; display:flex; flex-direction:column; align-items:center;
    justify-content:center; gap:16px; background:#faf9f5; font-family:-apple-system,"Segoe UI",sans-serif;
    -webkit-app-region: drag; }
  .spinner { width:28px; height:28px; border-radius:50%; border:3px solid rgba(204,120,92,0.25);
    border-top-color:rgb(204,120,92); animation:spin 0.8s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  #status { color:rgb(70,65,58); font-size:13px; }
</style></head>
<body><div class="spinner"></div><div id="status">正在准备 DeepSeek…</div></body></html>`;

// Paths the user picked in the native file dialog (realpaths). read-picked-image
// only reads files in this set, so the page cannot use it to read arbitrary
// images. Map keeps insertion order: the first key is the oldest entry.
const APPROVED_PICKED_PATHS_MAX = 200;
const approvedPickedPaths = new Map();

function approvePickedPaths(filePaths) {
  for (const p of filePaths) {
    let real;
    try {
      real = fs.realpathSync(p);
    } catch {
      continue; // vanished between the dialog and here — nothing to approve
    }
    approvedPickedPaths.delete(real);
    approvedPickedPaths.set(real, true);
  }
  while (approvedPickedPaths.size > APPROVED_PICKED_PATHS_MAX) {
    approvedPickedPaths.delete(approvedPickedPaths.keys().next().value);
  }
}

// Backs the composer's "choose a file" button (file-picker.js) — returns
// selected paths only. The renderer never reads file contents through
// this; the agent opens the paths itself with its own tools. The one
// exception is read-picked-image below, for images the user picked here.
ipcMain.handle('dsh-desktop:pick-files', async (event) => {
  // Only the dsh page itself may open a native dialog. Without this check any
  // frame inside the window (an iframe, or a page the window got navigated to)
  // that can reach the exposed bridge could pop file dialogs and harvest
  // local paths — the Electron security checklist's "validate the sender of
  // all IPC messages".
  const senderUrl = (event.senderFrame && event.senderFrame.url) || '';
  if (!(senderUrl === DSH_URL || senderUrl.startsWith(DSH_URL + '/'))) return [];
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
  });
  if (canceled) return [];
  approvePickedPaths(filePaths);
  return filePaths;
});

// Image types dsh's attachment store accepts (dsh-attachment-local: png, jpeg,
// webp, gif; dsh-client-ui-conversation rejects anything else). Size cap is
// dsh's default maxImageBytes (5 MiB, DEFAULT_MAX_IMAGE_BYTES). Duplicated in
// file-picker.js, which runs in the page and cannot require this file.
const PICKED_IMAGE_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const PICKED_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// Magic-number sniff. Returns the MIME type for the four accepted formats, or null.
function sniffImageMime(buf) {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// Reads one image the user picked with pick-files, so the page can attach it
// as a native thumbnail. Check order: sender, path shape, approval set,
// extension whitelist, regular file, size, magic number. Errors are short
// Chinese strings and never include the path.
ipcMain.handle('dsh-desktop:read-picked-image', async (event, p) => {
  if (!isDshSender(event)) return { ok: false, error: '未授权的发送方' };
  if (typeof p !== 'string' || !path.isAbsolute(p)) return { ok: false, error: '未授权的路径' };
  let real;
  try {
    real = fs.realpathSync(p);
  } catch {
    return { ok: false, error: '未授权的路径' };
  }
  if (!approvedPickedPaths.has(real)) return { ok: false, error: '未授权的路径' };
  if (!PICKED_IMAGE_MIME_BY_EXT[path.extname(p).toLowerCase()]) return { ok: false, error: '不支持的图片格式' };
  try {
    const st = await fs.promises.stat(real);
    if (!st.isFile()) return { ok: false, error: '不是普通文件' };
    if (st.size > PICKED_IMAGE_MAX_BYTES) return { ok: false, error: '图片超过 5 MB' };
    const buf = await fs.promises.readFile(real);
    if (buf.length > PICKED_IMAGE_MAX_BYTES) return { ok: false, error: '图片超过 5 MB' };
    const mime = sniffImageMime(buf);
    if (!mime) return { ok: false, error: '文件内容不是支持的图片' };
    return { ok: true, name: path.basename(p), mime, base64: buf.toString('base64') };
  } catch {
    return { ok: false, error: '无法读取该图片' };
  }
});

// Folder twin of pick-files above — same sender check, same paths-only return.
ipcMain.handle('dsh-desktop:pick-folders', async (event) => {
  // Same sender validation as pick-files: only the dsh page may open a dialog.
  const senderUrl = (event.senderFrame && event.senderFrame.url) || '';
  if (!(senderUrl === DSH_URL || senderUrl.startsWith(DSH_URL + '/'))) return [];
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'multiSelections'],
  });
  return canceled ? [] : filePaths;
});

// The bundled fonts live on disk, but the page is served from
// http://127.0.0.1:3080 — Chromium blocks file:// subresources from an http
// origin, and fonts are CORS-checked on top of that. So serve them over a
// privileged custom scheme with CORS enabled instead. Must be declared
// before app ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'dshfont',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

function registerFontProtocol() {
  protocol.handle('dshfont', (request) => {
    // dshfont://f/<name>.woff2 — read the name off the pathname, which
    // preserves case (hostnames get lowercased by the standard scheme).
    let name;
    try {
      name = path.basename(decodeURIComponent(new URL(request.url).pathname));
    } catch {
      return new Response('bad request', { status: 400 });
    }
    const file = path.join(__dirname, 'fonts', name);
    if (!file.startsWith(path.join(__dirname, 'fonts') + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

// ── Getting a DSH web server to talk to ─────────────────────────────────
//
// Two ways this app can end up with something at DSH_URL:
//  1. The user already has `@deepseek-ai/dsh` installed and `dsh web`
//     running externally (the personal build assumes this — it never
//     bundles dsh, so this is the only path that can succeed).
//  2. This build vendors a full copy of `@deepseek-ai/dsh` under
//     `dsh-vendor/` (see scripts/vendor-dsh.js). If nothing answers at
//     DSH_URL, and a vendored copy exists, spawn it ourselves.
// If neither applies, tell the user how to fix it instead of showing a
// blank window pointed at a server that doesn't exist.

let dshChild = null; // only set if THIS process spawned dsh — only then do we kill it on quit
let dshBinPath = null; // the dsh bin we spawned, kept so the archive page can restart the same copy
let mainWindow = null; // the dsh window; the archive page's dialog and reload target
let quitting = false; // set in before-quit so a restart can't respawn dsh after the app is gone

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

function dshBinIn(vendorDir) {
  const p = path.join(vendorDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  return fs.existsSync(p) ? p : null;
}

function unzip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    execFile('/usr/bin/unzip', ['-q', '-o', zipPath, '-d', destDir], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function vendoredDshBin() {
  const devBin = dshBinIn(path.join(__dirname, 'dsh-vendor'));
  if (devBin) return devBin;

  const extractedDir = path.join(app.getPath('userData'), 'dsh-vendor');
  const extractedBin = dshBinIn(extractedDir);
  if (extractedBin) return extractedBin;

  const zip = path.join(process.resourcesPath || '', 'dsh-vendor.zip');
  if (!fs.existsSync(zip)) return null;
  await unzip(zip, app.getPath('userData'));
  return dshBinIn(extractedDir);
}

function npmCliIn(vendorDir) {
  const p = path.join(vendorDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return fs.existsSync(p) ? p : null;
}

async function vendoredNpmCli() {
  const devCli = npmCliIn(path.join(__dirname, 'npm-vendor'));
  if (devCli) return devCli;

  const extractedDir = path.join(app.getPath('userData'), 'npm-vendor');
  const extractedCli = npmCliIn(extractedDir);
  if (extractedCli) return extractedCli;

  const zip = path.join(process.resourcesPath || '', 'npm-vendor.zip');
  if (!fs.existsSync(zip)) return null;
  await unzip(zip, app.getPath('userData'));
  return npmCliIn(extractedDir);
}

function setLoadingStatus(loadingWin, text) {
  if (!loadingWin || loadingWin.isDestroyed()) return;
  loadingWin.webContents
    .executeJavaScript(`document.getElementById('status').textContent = ${JSON.stringify(text)};`)
    .catch(() => {});
}

// Windows has no fixed dsh version to bundle (see scripts/vendor-npm.sh for
// why that's a deliberate difference from the mac public build, not an
// oversight): it fetches @deepseek-ai/dsh@latest for real, live, using this
// vendored copy of npm running under Electron's own Node. Only runs once —
// once dsh-latest/node_modules exists, later launches skip straight to
// spawning it, so normal startup doesn't need the network at all.
function installLatestDsh(npmCli, destDir, loadingWin) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    setLoadingStatus(loadingWin, '首次启动，正在下载 DeepSeek Harness…');
    const child = spawn(
      process.execPath,
      [npmCli, 'install', '@deepseek-ai/dsh@latest', '--prefix', destDir, '--no-audit', '--no-fund', '--loglevel=error'],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'pipe' }
    );
    child.stdout.on('data', (d) => process.stdout.write(`[npm] ${d}`));
    child.stderr.on('data', (d) => process.stderr.write(`[npm] ${d}`));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`npm install 失败，退出码 ${code}`))));
  });
}

function waitForDsh(timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function tick() {
      pingDsh(700).then((up) => {
        if (up) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error('dsh web 启动超时'));
        setTimeout(tick, 500);
      });
    })();
  });
}

function spawnVendoredDsh(binPath) {
  // process.execPath + ELECTRON_RUN_AS_NODE makes Electron's OWN bundled
  // Node runtime execute this script, so a recipient doesn't need Node.js
  // installed system-wide just to run the bundled copy of dsh — this only
  // works because package.json pins Electron >=43, which bundles Node 24;
  // dsh's own dependencies use node:zlib/node:module APIs that don't exist
  // before Node 22.19. --expose-internals is dsh's own plugin-hmr module
  // requiring it at boot; without it dsh refuses to start at all, even
  // though a packaged desktop app has no use for hot-reloading plugins.
  // DSH_TRUSTED_HOSTS (comma-separated host[:port]) mirrors the remote
  // gateway's env var of the same name: when the desktop shell is the one
  // providing dsh while the gateway also fronts it, the spawned dsh must
  // trust the hosts the gateway proxies in for, or the /api browser-trust
  // fence 403s every proxied request. Set via launchctl setenv so the
  // packaged app inherits it from launchd.
  const trustedHosts = (process.env.DSH_TRUSTED_HOSTS || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  // --no-open is required from dsh 0.1.0-rc.8 onward: that release made
  // `dsh web` open the default browser on startup. Harmless when you run it
  // yourself from a terminal, wrong here — this app IS the window, so every
  // launch would also throw a browser tab at the same URL. The flag does not
  // exist before rc.8, so a vendored copy older than that would refuse to
  // start on an unknown option; scripts/vendor-dsh.sh pins the version this
  // app is built against, and both moved to rc.8 together.
  const dshArgs = ['--expose-internals', binPath, 'web', '--no-open', '--port', String(DSH_PORT)];
  for (const host of trustedHosts) dshArgs.push('--trusted-host', host);
  const child = spawn(process.execPath, dshArgs, {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'pipe',
  });
  child.stdout.on('data', (d) => process.stdout.write(`[dsh] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[dsh] ${d}`));
  child.on('exit', (code) => {
    // Only forget the handle if it is still this child; a restart may already
    // have stored its replacement.
    if (dshChild === child) dshChild = null;
    if (code && code !== 0) console.error(`[dsh] exited with code ${code}`);
  });
  return child;
}

async function ensureDsh(loadingWin) {
  if (await pingDsh(800)) return; // already running externally — nothing to do, nothing to clean up

  if (process.platform === 'win32') {
    const destDir = path.join(app.getPath('userData'), 'dsh-latest');
    let bin = dshBinIn(destDir);
    if (!bin) {
      const npmCli = await vendoredNpmCli();
      if (!npmCli) {
        throw new Error('安装包缺少内置的 npm，无法自动下载 DeepSeek Harness。');
      }
      await installLatestDsh(npmCli, destDir, loadingWin);
      bin = dshBinIn(destDir);
      if (!bin) throw new Error('DeepSeek Harness 下载完成，但没有找到可执行文件，请重试或反馈这个问题。');
    }
    setLoadingStatus(loadingWin, '正在启动…');
    dshBinPath = bin;
    dshChild = spawnVendoredDsh(bin);
    await waitForDsh(60000); // more generous than the mac timeout — first boot of a freshly npm-installed copy, not a pre-vetted vendored one
    return;
  }

  const bin = await vendoredDshBin();
  if (!bin) {
    throw new Error(
      '没有检测到正在运行的 DeepSeek Harness，这个安装包也没有内置版本。\n\n' +
        '请先安装并启动：\n' +
        'npm install -g @deepseek-ai/dsh\n' +
        'dsh web'
    );
  }
  setLoadingStatus(loadingWin, '正在启动…');
  dshBinPath = bin;
  dshChild = spawnVendoredDsh(bin);
  await waitForDsh(30000);
}

app.on('before-quit', () => {
  quitting = true;
  if (dshChild) dshChild.kill();
});

// ── Archived sessions: list / restore / delete ──────────────────────────
//
// The archive list lives in ~/.dsh/storages/workspace.json, which dsh itself
// writes, so restore/delete only run while dsh is stopped. We only ever stop
// and restart a copy this app spawned (dshChild); an externally run dsh is
// view-only here. Nothing is force-killed: if dsh ignores SIGTERM we give up
// and leave the data alone.

const CANNOT_MANAGE_REASON = '当前 dsh 不是由本应用启动的，无法在这里恢复或删除（只能查看）';
const ARCHIVE_STOP_TIMEOUT_MS = 10000;
const ARCHIVE_START_TIMEOUT_MS = 30000;
const SESSION_LIST_TIMEOUT_MS = 5000;
const ARCHIVE_MAX_IDS = 200;
const ARCHIVE_DIALOG_MAX_TITLES = 8;
const ARCHIVE_TITLE_MAX_CHARS = 60;

let archiveBusy = false; // synchronous check-and-set mutex around apply
let dshRestarting = null; // in-flight restart, so two triggers can't spawn two dsh
let cleanupBusy = false; // one cleanup action at a time (see the cleanup section below)

// Same sender check as pick-files / pick-folders above.
function isDshSender(event) {
  const senderUrl = (event.senderFrame && event.senderFrame.url) || '';
  return senderUrl === DSH_URL || senderUrl.startsWith(DSH_URL + '/');
}

function ownsLiveDsh() {
  return !!dshChild && dshChild.exitCode === null && dshChild.signalCode === null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

// Read-only titles lookup. The only RPC this code ever sends is session.list
// (no pagination: the host's cursor is unimplemented and the response has no
// next cursor). Any failure resolves to an empty map, so the list still shows
// up, just without titles. Titles come from projections.values.title, which
// is a string or null; cold sessions without a projection snapshot get null.
function fetchSessionTitles() {
  return new Promise((resolve) => {
    const rpcId = crypto.randomUUID();
    const body = JSON.stringify({ type: 'client-request', rpcId, method: 'session.list', payload: {} });
    let settled = false;
    let timer = null;
    let req = null;
    const finish = (titles) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (req) req.destroy();
      resolve(titles);
    };
    req = http.request(
      {
        host: '127.0.0.1',
        port: DSH_PORT,
        path: '/api/session.list',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', () => finish(new Map()));
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) return finish(new Map());
            const msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (msg.rpcId !== rpcId || !msg.result || msg.result.ok !== true) return finish(new Map());
            const titles = new Map();
            for (const item of msg.result.value.items || []) {
              const title = item && item.projections && item.projections.values && item.projections.values.title;
              if (item && typeof item.sessionId === 'string') {
                titles.set(item.sessionId, typeof title === 'string' ? title : null);
              }
            }
            finish(titles);
          } catch {
            finish(new Map());
          }
        });
      }
    );
    req.on('error', () => finish(new Map()));
    timer = setTimeout(() => finish(new Map()), SESSION_LIST_TIMEOUT_MS);
    req.end(body);
  });
}

// Validate renderer-supplied ids before they reach the native dialog or the
// archive code. Each id must be one the archive list currently holds.
function checkArchiveIds(ids, archivedIds) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > ARCHIVE_MAX_IDS) {
    return { error: `要处理的会话数量必须在 1 到 ${ARCHIVE_MAX_IDS} 之间` };
  }
  const archived = new Set(archivedIds);
  const out = new Set();
  for (const id of ids) {
    if (typeof id !== 'string' || id === '' || id === '.' || id === '..' || /[\/\\\0]/.test(id)) {
      return { error: '会话 ID 格式不正确' };
    }
    if (!archived.has(id)) return { error: '所选会话已不在归档列表中，请刷新后重试' };
    out.add(id);
  }
  return { ids: [...out] };
}

function oneLine(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return Array.from(flat).slice(0, ARCHIVE_TITLE_MAX_CHARS).join('');
}

// Native confirm dialog: the page cannot fake or bypass it. Button 0 (取消)
// is both the default and the cancel id, so Enter or Esc never confirms.
async function confirmArchiveAction(action, ids, titles) {
  const restore = action === 'restore';
  const verb = restore ? '恢复' : '删除';
  const lines = ids.slice(0, ARCHIVE_DIALOG_MAX_TITLES).map((id) => {
    const title = titles.get(id);
    return `· ${title ? oneLine(title) : '（无标题）'}`;
  });
  if (ids.length > ARCHIVE_DIALOG_MAX_TITLES) lines.push(`等共 ${ids.length} 个`);
  const notes = ['dsh 会短暂重启一次，正在运行的会话会被中断。'];
  if (!restore) {
    notes.push('会话文件会被移动到 ~/.dsh/trash/<时间>/，不会立即彻底删除，必要时可手动移回。');
  }
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const { response } = await dialog.showMessageBox(win, {
    type: restore ? 'question' : 'warning',
    buttons: ['取消', verb],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    message: `将${verb} ${ids.length} 个会话：\n${lines.join('\n')}`,
    detail: notes.join('\n'),
  });
  return response === 1;
}

// Stop the dsh child we own and wait until it has exited AND its port is
// closed (a graceful shutdown can still flush workspace.json after the
// listener closes). No SIGKILL. On timeout, dsh is still running, so the
// data is untouched; a one-time exit listener brings it back if it dies later.
async function stopOwnedDsh() {
  const child = dshChild;
  if (!child || !ownsLiveDsh()) throw new Error('dsh 已不在本应用的控制下，未做任何修改');
  child.kill('SIGTERM');
  const deadline = Date.now() + ARCHIVE_STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (childHasExited(child) && !(await isPortListening(DSH_PORT, 500))) return;
    await sleep(300);
  }
  const watchForLateExit = () => {
    child.once('exit', () => {
      if (quitting) return;
      restartDshIfDown().catch((err) => console.error(`[archive] 重新启动 dsh 失败：${err.message}`));
    });
  };
  if (childHasExited(child)) {
    restartDshIfDown().catch((err) => console.error(`[archive] 重新启动 dsh 失败：${err.message}`));
  } else {
    watchForLateExit();
  }
  throw new Error('dsh 没有在 10 秒内停止，已放弃本次操作，数据未做修改');
}

// Bring back the dsh copy we spawned, if nothing is serving the port and we
// don't still hold a live child. Reuses the saved bin path and spawn logic.
function restartDshIfDown() {
  if (dshRestarting) return dshRestarting;
  dshRestarting = (async () => {
    try {
      if (quitting) throw new Error('应用正在退出');
      if (ownsLiveDsh() || (await isPortListening(DSH_PORT, 500))) return;
      if (!dshBinPath) throw new Error('找不到 dsh 的启动文件，请手动运行 dsh web');
      dshChild = spawnVendoredDsh(dshBinPath);
      await waitForDsh(ARCHIVE_START_TIMEOUT_MS);
    } finally {
      dshRestarting = null;
    }
  })();
  return dshRestarting;
}

// confirmFn is optional: the cleanup page's archived-all passes its own dialog.
// archived-apply passes nothing and gets the standard restore/delete dialog.
async function runArchiveAction(action, ids, confirmFn) {
  const confirmed = confirmFn
    ? await confirmFn()
    : await confirmArchiveAction(action, ids, await fetchSessionTitles());
  if (!confirmed) return { ok: false, cancelled: true };
  // dsh could have gone away while the dialog was open.
  if (!ownsLiveDsh()) return { ok: false, error: CANNOT_MANAGE_REASON };

  let stopErr = null;
  let opErr = null;
  let done = 0;
  try {
    await stopOwnedDsh();
    try {
      if (action === 'restore') {
        done = unarchive(DSH_HOME, ids).restored.length;
      } else {
        done = deleteSessions(DSH_HOME, ids).deleted.length;
      }
    } catch (err) {
      opErr = err;
    }
  } catch (err) {
    stopErr = err;
  }

  // Always try to bring dsh back, whether or not the data step ran.
  let restartErr = null;
  try {
    await restartDshIfDown();
  } catch (err) {
    restartErr = err;
  }

  const problems = [];
  if (stopErr) problems.push(stopErr.message);
  if (opErr) problems.push(`${action === 'restore' ? '恢复' : '删除'}失败：${opErr.message}`);
  if (restartErr) problems.push(`dsh 重新启动失败：${restartErr.message}`);
  if (problems.length) return { ok: false, error: problems.join('；') };

  // Reload after the invoke returns: reloading now would destroy the page
  // that is awaiting this reply.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reloadIgnoringCache();
  }, 300);
  return { ok: true, done };
}

ipcMain.handle('dsh-desktop:archived-list', async (event) => {
  if (!isDshSender(event)) return { ok: false, canManage: false, reason: '无权访问', items: [] };
  const canManage = ownsLiveDsh();
  let ids;
  try {
    ids = listArchivedIds(DSH_HOME).ids.filter((id) => typeof id === 'string');
  } catch (err) {
    return { ok: false, canManage, reason: `读取归档列表失败：${err.message}`, items: [] };
  }
  const titles = ids.length ? await fetchSessionTitles() : new Map();
  const items = ids.map((id) => ({ id, title: titles.get(id) ?? null }));
  if (canManage) return { ok: true, canManage, items };
  return { ok: true, canManage, reason: CANNOT_MANAGE_REASON, items };
});

ipcMain.handle('dsh-desktop:archived-apply', async (event, action, ids) => {
  if (!isDshSender(event)) return { ok: false, error: '无权执行此操作' };
  if (action !== 'restore' && action !== 'delete') return { ok: false, error: '未知操作' };
  let archivedIds;
  try {
    archivedIds = listArchivedIds(DSH_HOME).ids.filter((id) => typeof id === 'string');
  } catch (err) {
    return { ok: false, error: `读取归档列表失败：${err.message}` };
  }
  const checked = checkArchiveIds(ids, archivedIds);
  if (checked.error) return { ok: false, error: checked.error };
  if (!ownsLiveDsh()) return { ok: false, error: CANNOT_MANAGE_REASON };
  if (archiveBusy) return { ok: false, error: '已有一个操作正在进行，请稍后再试' };
  archiveBusy = true;
  try {
    return await runArchiveAction(action, checked.ids);
  } finally {
    archiveBusy = false;
  }
});

// ── Cleanup: trash / backups / attachments / archived-all ───────────────
//
// Permanent deletion of three DSH_HOME subfolders, plus archived-all. Every
// action is confirmed with a native dialog before anything is removed. Only
// the children of trash/, backups/ and attachments/ are ever deleted (the roots
// stay). sessions, storages, profiles, skills, settings.yaml, .credentials*
// and gemini-keys.json are never listed here. archived-all goes through the
// same stop / delete / restart path as archived-apply, via runArchiveAction.

const CLEANUP_KINDS = ['trash', 'backups-keep-latest', 'backups-all', 'attachments', 'archived-all'];
const CLEANUP_DIR_BY_KIND = {
  trash: 'trash',
  'backups-keep-latest': 'backups',
  'backups-all': 'backups',
  attachments: 'attachments',
};

// Lstat that treats any error as "not there". Used only for listing, where a
// broken entry should be skipped rather than fail the whole listing.
function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

// Resolves ~/.dsh/<name> for cleanup. Missing gives null (nothing to do). A
// symlink or non-directory root is refused outright.
function cleanupRoot(name) {
  const root = path.join(DSH_HOME, name);
  let st;
  try {
    st = fs.lstatSync(root);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  if (st.isSymbolicLink()) throw new Error(`~/.dsh/${name} 是符号链接，已拒绝清理`);
  if (!st.isDirectory()) throw new Error(`~/.dsh/${name} 不是目录，已拒绝清理`);
  return root;
}

function cleanupRootOrNull(name) {
  try {
    return cleanupRoot(name);
  } catch {
    return null;
  }
}

// Total size of regular files under p. Symlinks are never followed and count
// as 0; unreadable entries are skipped.
function measureBytes(p) {
  const st = lstatOrNull(p);
  if (!st || st.isSymbolicLink()) return 0;
  if (st.isFile()) return st.size;
  if (!st.isDirectory()) return 0;
  let names;
  try {
    names = fs.readdirSync(p);
  } catch {
    return 0;
  }
  let total = 0;
  for (const name of names) total += measureBytes(path.join(p, name));
  return total;
}

// Number of regular files under p, recursively. Symlinks are not counted.
function countRegularFiles(p) {
  const st = lstatOrNull(p);
  if (!st || st.isSymbolicLink()) return 0;
  if (st.isFile()) return 1;
  if (!st.isDirectory()) return 0;
  let names;
  try {
    names = fs.readdirSync(p);
  } catch {
    return 0;
  }
  let n = 0;
  for (const name of names) n += countRegularFiles(path.join(p, name));
  return n;
}

// Direct children of a root, each with its lstat result.
function topEntries(root) {
  let names;
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const abs = path.join(root, name);
    const st = lstatOrNull(abs);
    if (st) out.push({ name, abs, st });
  }
  return out;
}

// Plain string comparison: names carry ISO timestamps, so the largest is the newest.
function latestName(names) {
  let best = null;
  for (const n of names) if (best === null || n > best) best = n;
  return best;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

// Read-only summary for the cleanup page. Nothing here writes or deletes.
ipcMain.handle('dsh-desktop:cleanup-info', (event) => {
  if (!isDshSender(event)) return { ok: false, error: '无权访问' };
  const trash = { bytes: 0, count: 0 };
  const backups = { bytes: 0, count: 0, latest: null };
  const attachments = { bytes: 0, count: 0 };
  const archived = { count: 0 };

  const trashRoot = cleanupRootOrNull('trash');
  if (trashRoot) {
    const entries = topEntries(trashRoot);
    trash.bytes = entries.reduce((s, e) => s + measureBytes(e.abs), 0);
    trash.count = entries.filter((e) => e.st.isDirectory()).length;
  }

  const backupRoot = cleanupRootOrNull('backups');
  if (backupRoot) {
    const entries = topEntries(backupRoot);
    const files = entries.filter((e) => !e.st.isDirectory());
    backups.bytes = entries.reduce((s, e) => s + measureBytes(e.abs), 0);
    backups.count = files.length;
    backups.latest = latestName(files.map((e) => e.name));
  }

  const attachmentRoot = cleanupRootOrNull('attachments');
  if (attachmentRoot) {
    attachments.bytes = measureBytes(attachmentRoot);
    attachments.count = countRegularFiles(attachmentRoot);
  }

  try {
    archived.count = listArchivedIds(DSH_HOME).ids.filter((id) => typeof id === 'string').length;
  } catch {
    archived.count = 0;
  }

  return { ok: true, canManage: ownsLiveDsh(), trash, backups, attachments, archived };
});

// Decides what a kind would delete. Done before the dialog so the dialog can
// state the real count and size. removeCleanupItems re-checks every item.
function planCleanup(kind) {
  const dirName = CLEANUP_DIR_BY_KIND[kind];
  const root = cleanupRoot(dirName);
  if (!root) return { dirName, items: [], bytes: 0, latest: null };
  const entries = topEntries(root);
  let chosen = entries;
  let latest = null;
  if (kind === 'backups-keep-latest' || kind === 'backups-all') {
    const files = entries.filter((e) => !e.st.isDirectory());
    latest = latestName(files.map((e) => e.name));
    chosen = kind === 'backups-all' ? files : files.filter((e) => e.name !== latest);
  }
  const items = chosen.map((e) => ({ abs: e.abs, bytes: measureBytes(e.abs) }));
  const bytes = items.reduce((s, it) => s + it.bytes, 0);
  return { dirName, items, bytes, latest };
}

// Removes the planned items one at a time. Each item is re-checked right before
// removal. A symlink is unlinked itself and never followed. A real entry must
// still resolve inside the root, or it is counted as failed and left alone.
async function removeCleanupItems(dirName, items) {
  const result = { removed: 0, failed: 0, freed: 0 };
  const root = cleanupRoot(dirName); // re-checked: the root may have been swapped for a symlink
  if (!root) return result;
  const realRoot = fs.realpathSync(root);
  for (const item of items) {
    let st;
    try {
      st = fs.lstatSync(item.abs);
    } catch (err) {
      if (err.code === 'ENOENT') continue; // already gone
      result.failed++;
      continue;
    }
    if (!st.isSymbolicLink()) {
      let real = null;
      try {
        real = fs.realpathSync(item.abs);
      } catch {
        real = null;
      }
      if (!real || !real.startsWith(realRoot + path.sep)) {
        result.failed++;
        continue;
      }
    }
    try {
      await fs.promises.rm(item.abs, { recursive: true, force: true });
      result.removed++;
      result.freed += item.bytes;
    } catch {
      result.failed++;
    }
  }
  return result;
}

// Native confirm dialog. Button 0 (取消) is both the default and the cancel id,
// so Enter or Esc never confirms.
async function confirmCleanupDialog(verb, message, detail) {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['取消', verb],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    message,
    detail,
  });
  return response === 1;
}

function cleanupConfirmText(kind, plan) {
  const n = plan.items.length;
  const size = formatBytes(plan.bytes);
  if (kind === 'trash') {
    return {
      verb: '清空回收区',
      message: `将永久删除 ~/.dsh/trash/ 下的全部 ${n} 项，约 ${size}。此操作不可恢复。`,
      detail: '回收区里是此前删除的会话文件，清空后这些会话将无法再恢复。',
    };
  }
  if (kind === 'backups-keep-latest') {
    return {
      verb: '删除旧备份',
      message: `将永久删除 ~/.dsh/backups/ 下除最新一份（${plan.latest}）外的 ${n} 个备份文件，约 ${size}。此操作不可恢复。`,
      detail: '备份是 workspace.json 的历史副本。删除后将无法再从这些旧版本还原归档列表。',
    };
  }
  if (kind === 'backups-all') {
    return {
      verb: '删除全部备份',
      message: `将永久删除 ~/.dsh/backups/ 下全部 ${n} 个备份文件，约 ${size}。此操作不可恢复。`,
      detail: '删除后将无法再从备份还原 workspace.json 的历史版本。',
    };
  }
  return {
    verb: '删除附件',
    message: `将永久删除 ~/.dsh/attachments/ 下全部 ${n} 项，约 ${size}。此操作不可恢复。`,
    detail: '仍显示在会话里的图片附件之后可能无法再显示。',
  };
}

async function cleanupFiles(kind) {
  const plan = planCleanup(kind);
  if (plan.items.length === 0) return { ok: true, freedBytes: 0, done: 0 };
  const { verb, message, detail } = cleanupConfirmText(kind, plan);
  if (!(await confirmCleanupDialog(verb, message, detail))) return { ok: false, cancelled: true, error: '已取消' };
  const r = await removeCleanupItems(plan.dirName, plan.items);
  if (r.failed) return { ok: false, error: `${r.failed} 项未能删除`, freedBytes: r.freed, done: r.removed };
  return { ok: true, freedBytes: r.freed, done: r.removed };
}

// Same stop / deleteSessions / restart path as archived-apply 'delete', with
// this page's own confirm dialog instead of the standard one.
async function cleanupArchivedAll() {
  if (!ownsLiveDsh()) return { ok: false, error: CANNOT_MANAGE_REASON };
  let archivedIds;
  try {
    archivedIds = listArchivedIds(DSH_HOME).ids.filter((id) => typeof id === 'string');
  } catch (err) {
    return { ok: false, error: `读取归档列表失败：${err.message}` };
  }
  if (archivedIds.length === 0) return { ok: true, done: 0 };
  const checked = checkArchiveIds(archivedIds, archivedIds);
  if (checked.error) return { ok: false, error: checked.error };
  const n = checked.ids.length;
  archiveBusy = true;
  try {
    const r = await runArchiveAction('delete', checked.ids, () =>
      confirmCleanupDialog(
        '删除全部归档会话',
        `将永久删除全部 ${n} 个已归档会话，会话文件先移到回收区，dsh 会短暂重启一次，正在运行的会话会被中断。`,
        '移入回收区的文件仍占用空间，需再执行“清空回收区”才会彻底删除。此操作不可恢复。'
      )
    );
    if (r.cancelled) return { ok: false, cancelled: true, error: '已取消' };
    return r;
  } finally {
    archiveBusy = false;
  }
}

// One handler for every cleanup kind. The kind must be on the whitelist. The
// shared busy flags refuse a second cleanup, and a running archive operation.
ipcMain.handle('dsh-desktop:cleanup-apply', async (event, kind) => {
  if (!isDshSender(event)) return { ok: false, error: '无权执行此操作' };
  if (!CLEANUP_KINDS.includes(kind)) return { ok: false, error: '未知的清理类型' };
  if (cleanupBusy || archiveBusy) return { ok: false, error: '已有一个操作正在进行，请稍后再试' };
  cleanupBusy = true;
  try {
    if (kind === 'archived-all') return await cleanupArchivedAll();
    return await cleanupFiles(kind);
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    cleanupBusy = false;
  }
});

// Inset traffic lights are a macOS concept (titleBarStyle/trafficLightPosition
// are no-ops elsewhere) — other platforms get the normal native title bar,
// and windows-overrides.css undoes theme.css's mac-only clearance hack to
// match.
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'DSH Desktop',
    backgroundColor: '#faf9f5',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadURL(DSH_URL);
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Keep this window on dsh. A link in a chat message or tool output with
  // target=_blank / window.open used to get Electron's default (a second
  // in-app window), and a plain navigation would replace the dsh page — and
  // the dom-ready hook below would then inject theme scripts into whatever
  // site that was. Web links go to the system browser instead, and only
  // http(s): handing file:, dshfont: or custom schemes to shell.openExternal
  // is how a rendered link turns into local code execution.
  const openExternalSafely = (url) => {
    try {
      const { protocol: scheme } = new URL(url);
      if (scheme === 'http:' || scheme === 'https:') shell.openExternal(url);
    } catch {
      // unparseable URL — drop it
    }
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url === DSH_URL || url.startsWith(DSH_URL + '/')) return;
    event.preventDefault();
    openExternalSafely(url);
  });

  const applyTheme = () => {
    win.webContents.insertCSS(THEME_CSS);
    if (process.platform !== 'darwin') win.webContents.insertCSS(WINDOWS_OVERRIDES_CSS);
    win.webContents.executeJavaScript(LABEL_TWEAKS_JS);
    win.webContents.executeJavaScript(TRACE_COLLAPSE_JS);
    win.webContents.executeJavaScript(TRACE_TRANSLATE_JS);
    win.webContents.executeJavaScript(FONT_PICKER_JS);
    win.webContents.executeJavaScript(ICONS_JS);
    win.webContents.executeJavaScript(BATCH_SELECT_JS);
    win.webContents.executeJavaScript(FILE_PICKER_JS);
    if (ARCHIVED_PAGE_JS) win.webContents.executeJavaScript(ARCHIVED_PAGE_JS);
    win.webContents.executeJavaScript(APPROVAL_HOTKEY_JS);
  };
  win.webContents.on('dom-ready', applyTheme);
  win.webContents.on('did-navigate-in-page', applyTheme);
}

function createLoadingWindow() {
  const win = new BrowserWindow({
    width: 360,
    height: 200,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'DSH Desktop',
    backgroundColor: '#faf9f5',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    webPreferences: { sandbox: true },
  });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(LOADING_HTML));
  return win;
}

app.whenReady().then(async () => {
  registerFontProtocol();
  const loadingWin = createLoadingWindow();
  try {
    await ensureDsh(loadingWin);
  } catch (err) {
    dialog.showErrorBox('无法启动 DeepSeek Harness', err.message);
    if (!loadingWin.isDestroyed()) loadingWin.close();
    app.quit();
    return;
  }
  createWindow();
  if (!loadingWin.isDestroyed()) loadingWin.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
