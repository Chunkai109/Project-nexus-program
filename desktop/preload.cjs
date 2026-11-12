// Exposes the desktop app's settings to the page as window.smartphysioDesktop
// (read by frontend/src/lib/desktop.ts), plus the page-zoom controls used by
// frontend/src/components/layout/useAppZoom.ts. Nothing else from Node or
// Electron is reachable from the page.
const { contextBridge, ipcRenderer, webFrame } = require('electron')

contextBridge.exposeInMainWorld('smartphysioDesktop', {
  ...ipcRenderer.sendSync('smartphysio:get-config'),
  /** Sets the real page zoom. The web app is the only thing that sets it. */
  setZoom: (factor) => {
    const f = Number(factor)
    if (Number.isFinite(f) && f >= 0.5 && f <= 3) webFrame.setZoomFactor(f)
  },
  getZoom: () => webFrame.getZoomFactor(),
})
