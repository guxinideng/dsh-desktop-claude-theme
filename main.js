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

// Backs the composer's "choose a file" button (file-picker.js) — returns
// selected paths only. The renderer never reads file contents through
// this; the agent opens the paths itself with its own tools.
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
  return canceled ? [] : filePaths;
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

async function runArchiveAction(action, ids) {
  const titles = await fetchSessionTitles();
  if (!(await confirmArchiveAction(action, ids, titles))) return { ok: false, cancelled: true };
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
