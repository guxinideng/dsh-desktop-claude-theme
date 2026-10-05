// Electron entry point used ONLY by scripts/test-electron-security.mjs — never
// shipped (not listed in any electron-builder files list).
//
// It runs the app's real main.js, with three differences that make it
// testable without touching the user's machine:
//   * shell.openExternal and dialog.showOpenDialog are replaced by stubs that
//     report to the test instead of opening a browser / a file dialog;
//   * userData is a throwaway directory, the dock icon is hidden and windows
//     are fully transparent, so a run does not disturb whoever is at the Mac;
//   * a small command loop lets the test drive the window over HTTP
//     (eval / loadURL / capture / status / quit).
//
// Env: HARNESS_CTRL (http://127.0.0.1:<port>), HARNESS_USER_DATA (dir),
//      DSH_DESKTOP_PORT (read by main.js), HARNESS_CLIPBOARD (optional text
//      returned by clipboard.readText).
const { app, shell, dialog, clipboard, session, BrowserWindow } = require('electron');
const fs = require('fs');

const CTRL = process.env.HARNESS_CTRL;
app.setPath('userData', process.env.HARNESS_USER_DATA);
if (process.platform === 'darwin' && app.dock) app.dock.hide();

function post(body) {
  return fetch(`${CTRL}/__main`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

shell.openExternal = async (url) => {
  post({ type: 'openExternal', url });
};
dialog.showOpenDialog = async () => {
  post({ type: 'dialog' });
  return { canceled: false, filePaths: ['/tmp/dsh harness/picked file.txt'] };
};
// Login-token prompt (see askForLaunchUrl in main.js): never show the real
// dialog, and never touch the real clipboard — the test supplies the text.
let messageBoxes = 0;
dialog.showMessageBox = async () => {
  post({ type: 'messageBox' });
  // answer "从剪贴板读取" twice, then "退出" so a bad clipboard cannot loop forever
  return { response: ++messageBoxes > 2 ? 1 : 0 };
};
if (process.env.HARNESS_CLIPBOARD) clipboard.readText = () => process.env.HARNESS_CLIPBOARD;
app.on('browser-window-created', (_e, win) => win.setOpacity(0));

require('../main.js');

const mainWindow = () =>
  BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().startsWith('http'));

async function run(cmd) {
  const win = mainWindow();
  switch (cmd.cmd) {
    case 'status':
      return {
        windows: BrowserWindow.getAllWindows().length,
        url: win ? win.webContents.getURL() : null,
        title: win ? win.getTitle() : null,
      };
    case 'eval':
      return win.webContents.executeJavaScript(cmd.code, true);
    case 'loadURL':
      await win.loadURL(cmd.url);
      return true;
    case 'resize':
      win.setSize(cmd.width, cmd.height);
      return true;
    case 'capture': {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(cmd.path, img.toPNG());
      return true;
    }
    case 'quit':
      // flush first so a later launch on the same userData sees the login cookie
      session.defaultSession.cookies.flushStore().finally(() => app.exit(0));
      return true;
    default:
      throw new Error('unknown command ' + cmd.cmd);
  }
}

(async function loop() {
  for (;;) {
    let cmd = null;
    try {
      const res = await fetch(`${CTRL}/__cmd`);
      if (res.status === 200) cmd = await res.json();
    } catch {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    if (!cmd) continue;
    let out;
    try {
      out = { type: 'result', id: cmd.id, value: await run(cmd) };
    } catch (err) {
      out = { type: 'result', id: cmd.id, error: String((err && err.message) || err) };
    }
    await post(out);
  }
})();
