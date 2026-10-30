// Exposes the desktop app's settings to the page as window.smartphysioDesktop
// (read by frontend/src/lib/desktop.ts). Nothing else from Node or Electron is
// reachable from the page.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('smartphysioDesktop', ipcRenderer.sendSync('smartphysio:get-config'))
