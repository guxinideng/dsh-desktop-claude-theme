const { app, BrowserWindow, protocol, net, dialog, ipcMain } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');

const DSH_PORT = 3080;
const DSH_URL = `http://127.0.0.1:${DSH_PORT}`;

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
const FILE_PICKER_JS = fs.readFileSync(path.join(__dirname, 'file-picker.js'), 'utf8');
const APPROVAL_HOTKEY_JS = fs.readFileSync(path.join(__dirname, 'approval-hotkey.js'), 'utf8');

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
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
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
    const name = path.basename(decodeURIComponent(new URL(request.url).pathname));
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
  const child = spawn(process.execPath, ['--expose-internals', binPath, 'web', '--port', String(DSH_PORT)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'pipe',
  });
  child.stdout.on('data', (d) => process.stdout.write(`[dsh] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[dsh] ${d}`));
  child.on('exit', (code) => {
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
  dshChild = spawnVendoredDsh(bin);
  await waitForDsh(30000);
}

app.on('before-quit', () => {
  if (dshChild) dshChild.kill();
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

  const applyTheme = () => {
    win.webContents.insertCSS(THEME_CSS);
    if (process.platform !== 'darwin') win.webContents.insertCSS(WINDOWS_OVERRIDES_CSS);
    win.webContents.executeJavaScript(LABEL_TWEAKS_JS);
    win.webContents.executeJavaScript(TRACE_COLLAPSE_JS);
    win.webContents.executeJavaScript(TRACE_TRANSLATE_JS);
    win.webContents.executeJavaScript(FONT_PICKER_JS);
    win.webContents.executeJavaScript(FILE_PICKER_JS);
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
