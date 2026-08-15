const { contextBridge, ipcRenderer } = require('electron');

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
});
