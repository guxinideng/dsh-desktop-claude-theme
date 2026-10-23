const { contextBridge, ipcRenderer, webUtils } = require('electron');

// DSH's own composer has no file picker — its "+" button opens the
// slash-command menu, and attachments only arrive by dragging or pasting
// an image. Everything else (code, docs, logs) has to be referenced by
// path, which the agent then opens with its own filesystem tools. This
// bridge is the minimum needed to add a real "choose a file" button:
// the renderer asks for a native open dialog, and gets back paths only —
// no file contents cross this boundary, and the renderer cannot open a
// dialog for any other purpose.
contextBridge.exposeInMainWorld('dshDesktop', {
  pickFiles: () => ipcRenderer.invoke('dsh-desktop:pick-files'),
  pickFolders: () => ipcRenderer.invoke('dsh-desktop:pick-folders'),
  // Only for paths returned by pickFiles. Main process checks the path is in
  // that approved set and is a supported image; returns { ok, name, mime, base64 }.
  readPickedImage: (p) => ipcRenderer.invoke('dsh-desktop:read-picked-image', p),
  // Electron 43 removed File.path; webUtils is the only way to get a path.
  // Returns just the path string, never file contents.
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || ''; } catch (_) { return ''; }
  },
  // Archived-sessions page. The list is read-only; apply runs restore or
  // delete behind a native confirm dialog in the main process.
  archivedList: () => ipcRenderer.invoke('dsh-desktop:archived-list'),
  archivedApply: (action, ids) => ipcRenderer.invoke('dsh-desktop:archived-apply', action, ids),
  // Cleanup page. cleanupInfo is read-only. cleanupApply(kind) confirms with a
  // native dialog in the main process before deleting; kind is whitelisted there.
  cleanupInfo: () => ipcRenderer.invoke('dsh-desktop:cleanup-info'),
  cleanupApply: (kind) => ipcRenderer.invoke('dsh-desktop:cleanup-apply', kind),
});
