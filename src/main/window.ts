import { join } from 'node:path'

import { BrowserWindow, app, type OnHeadersReceivedListenerDetails } from 'electron'

import { trustedDevelopmentRendererUrl } from './development-url'
import { PRODUCTION_CSP, SAVEPOINT_APP_URL } from './protocol'

function applyProductionCsp(window: BrowserWindow): void {
  if (!app.isPackaged) return
  window.webContents.session.webRequest.onHeadersReceived(
    (details: OnHeadersReceivedListenerDetails, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [PRODUCTION_CSP]
        }
      })
    }
  )
}

function lockDownWebContents(window: BrowserWindow): void {
  const { webContents } = window
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  webContents.on('will-navigate', (event, url) => {
    if (url !== webContents.getURL()) event.preventDefault()
  })
  // Server-side redirects do not emit `will-navigate`. SavePoint never needs
  // renderer redirects, so block them before a development server could move
  // this preload-bearing window away from its approved loopback origin.
  webContents.on('will-redirect', (event) => event.preventDefault())
  webContents.on('will-attach-webview', (event) => event.preventDefault())
  webContents.session.setPermissionCheckHandler(() => false)
  webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  applyProductionCsp(window)
}

export async function createMainWindow(
  onCreated?: (window: BrowserWindow) => void
): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'SavePoint',
    backgroundColor: '#171816',
    autoHideMenuBar: true,
    webPreferences: {
      // Sandboxed Electron preloads execute as CommonJS in the restricted
      // preload runtime. The build config emits this dedicated CJS bundle.
      preload: join(__dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
      devTools: !app.isPackaged
    }
  })
  lockDownWebContents(window)
  onCreated?.(window)
  window.once('ready-to-show', () => window.show())

  const developmentUrl = trustedDevelopmentRendererUrl(
    process.env.ELECTRON_RENDERER_URL,
    app.isPackaged
  )
  if (developmentUrl) await window.loadURL(developmentUrl)
  else await window.loadURL(SAVEPOINT_APP_URL)
  return window
}
