// SmartPhysio desktop app (Electron main process).
//
// Serves the built web app from http://127.0.0.1:<port> rather than file://
// or https:// on purpose: localhost counts as a secure context (so the camera
// works), and it isn't https, so the browser allows the plain ws:// connection
// to the ESP32 hub. It also starts the bundled AI form-check server and stops
// it when the app exits.

const { app, BrowserWindow, ipcMain, session, shell } = require('electron')
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')

// Fixed so the page keeps the same origin between launches: login sessions
// and other localStorage data are stored per origin.
const PREFERRED_WEB_PORT = 47710

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.task': 'application/octet-stream',
}

let mainWindow = null
let webServer = null
let webOrigin = null
let aiProcess = null
let aiServerUrl = ''

function resourcePath(...parts) {
  return app.isPackaged ? path.join(process.resourcesPath, ...parts) : path.join(__dirname, ...parts)
}

function webRoot() {
  return app.isPackaged ? resourcePath('web') : path.join(__dirname, '..', 'frontend', 'dist')
}

function logFile() {
  const dir = app.getPath('logs')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'ai-server.log')
}

function listenOn(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server.address().port)
    })
  })
}

async function freePort() {
  const probe = net.createServer()
  const port = await listenOn(probe, 0)
  await new Promise((resolve) => probe.close(resolve))
  return port
}

// --- Web app ---------------------------------------------------------------

async function startWebServer() {
  const root = path.resolve(webRoot())
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    throw new Error(`Web app not found at ${root}. Build it first: npm --prefix frontend run build`)
  }

  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    let filePath = path.resolve(root, '.' + urlPath)
    if (!filePath.startsWith(root + path.sep) && filePath !== root) {
      res.writeHead(403).end()
      return
    }
    // Client-side routes (e.g. /patient/exercises) have no file: serve the app shell.
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      if (path.extname(urlPath)) {
        res.writeHead(404).end()
        return
      }
      filePath = path.join(root, 'index.html')
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    fs.createReadStream(filePath)
      .on('error', () => res.destroy())
      .pipe(res)
  })

  let port
  try {
    port = await listenOn(server, PREFERRED_WEB_PORT)
  } catch {
    // Something else holds the usual port; any free one works, but saved
    // logins won't carry over to this launch (different origin).
    port = await listenOn(server, 0)
  }
  webServer = server
  webOrigin = `http://127.0.0.1:${port}`
}

// --- AI form-check server ----------------------------------------------------

function aiServerCommand(port) {
  const args = ['--port', String(port), '--exit-on-stdin-close']
  const exeName = process.platform === 'win32' ? 'smartphysio-ai.exe' : 'smartphysio-ai'
  const bundled = app.isPackaged
    ? resourcePath('ai-server', exeName)
    : path.join(__dirname, 'ai-server', 'dist', 'smartphysio-ai', exeName)
  if (fs.existsSync(bundled)) return { command: bundled, args }

  // Development fallback: run the server from source with the local Python.
  const script = path.join(__dirname, 'ai-server', 'run_server.py')
  for (const python of ['python3', 'python']) {
    const probe = spawnSync(python, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' })
    if (!probe.error && probe.status === 0) return { command: python, args: [script, ...args] }
  }
  return null
}

async function startAiServer() {
  const port = await freePort()
  aiServerUrl = `http://127.0.0.1:${port}`
  const cmd = aiServerCommand(port)
  const log = fs.createWriteStream(logFile(), { flags: 'w' })
  if (!cmd) {
    log.write('AI server not found and no Python available; AI Form Check will show as unavailable.\n')
    return
  }

  // stdin stays open as a pipe for the app's lifetime; the server exits when
  // it closes, which also covers the app crashing instead of quitting.
  aiProcess = spawn(cmd.command, cmd.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  aiProcess.stdout.pipe(log)
  aiProcess.stderr.pipe(log)
  aiProcess.on('error', (err) => log.write(`Failed to start AI server: ${err.message}\n`))
  aiProcess.on('exit', (code) => {
    log.write(`AI server exited with code ${code}\n`)
    aiProcess = null
  })
}

function stopAiServer() {
  if (!aiProcess) return
  const proc = aiProcess
  aiProcess = null
  proc.stdin.end()
  proc.kill()
  if (process.platform === 'win32' && proc.pid) {
    spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  }
}

// --- Window --------------------------------------------------------------------

function isOwnOrigin(url) {
  try {
    return new URL(url).origin === webOrigin
  } catch {
    return false
  }
}

function lockDownSession() {
  // Camera only, and only for our own page. Everything else is refused.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(permission === 'media' && isOwnOrigin(details.requestingUrl))
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return permission === 'media' && requestingOrigin === webOrigin
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'SmartPhysio',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // Outside links open in the normal browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !isOwnOrigin(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isOwnOrigin(url)) {
      event.preventDefault()
      if (/^https?:\/\//.test(url)) shell.openExternal(url)
    }
  })

  mainWindow.loadURL(`${webOrigin}/login`)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

ipcMain.on('smartphysio:get-config', (event) => {
  event.returnValue = { aiServerUrl, appVersion: app.getVersion() }
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    await startAiServer()
    await startWebServer()
    lockDownSession()
    createWindow()
  })

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    stopAiServer()
    webServer?.close()
  })
}
