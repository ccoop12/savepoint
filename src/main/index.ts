import { join } from 'node:path'

import { BrowserWindow, app, dialog } from 'electron'

import { IPC_CHANNELS } from '../shared'
import { trustedDevelopmentRendererUrl } from './development-url'
import { registerIpcHandlers } from './ipc'
import { installSavePointProtocol, registerSavePointScheme } from './protocol'
import {
  AutoCheckpointManager,
  GitCaptureService,
  SavePointDatabase,
  SavePointService
} from './services'
import { createMainWindow } from './window'

app.enableSandbox()
registerSavePointScheme()

let mainWindow: BrowserWindow | null = null
let database: SavePointDatabase | null = null
let autoCheckpoints: AutoCheckpointManager | null = null
let removeIpcHandlers: (() => void) | null = null
let removeProtocolHandler: (() => void) | null = null
let shutdownComplete = false
let shutdownPromise: Promise<void> | null = null

async function openApplication(): Promise<void> {
  const usesDevelopmentServer = Boolean(
    trustedDevelopmentRendererUrl(process.env.ELECTRON_RENDERER_URL, app.isPackaged)
  )
  if (!usesDevelopmentServer) {
    removeProtocolHandler = await installSavePointProtocol(join(__dirname, '../renderer'))
  }
  const wasmPath = app.isPackaged ? join(process.resourcesPath, 'sql-wasm.wasm') : undefined
  database = await SavePointDatabase.open({
    filePath: join(app.getPath('userData'), 'savepoint.sqlite3'),
    wasmPath
  })
  const capture = new GitCaptureService()
  autoCheckpoints = new AutoCheckpointManager(database, capture, {
    onCheckpoint: () => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.checkpointsChanged)
      }
    }
  })
  const service = new SavePointService(database, capture, autoCheckpoints)
  removeIpcHandlers = registerIpcHandlers(service, { getWindow: () => mainWindow })
  autoCheckpoints.sync()
  mainWindow = await createMainWindow((window) => {
    // Set before loadURL/loadFile so startup IPC has a trusted owner window.
    mainWindow = window
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function shutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise
  shutdownPromise = (async () => {
    removeIpcHandlers?.()
    removeIpcHandlers = null
    removeProtocolHandler?.()
    removeProtocolHandler = null
    autoCheckpoints?.dispose()
    autoCheckpoints = null
    await database?.close()
    database = null
  })()
  return shutdownPromise
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  void app
    .whenReady()
    .then(openApplication)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown startup error'
      dialog.showErrorBox('SavePoint could not start', message)
      app.quit()
    })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow((window) => {
        mainWindow = window
      }).then((window) => {
        mainWindow = window
        mainWindow.on('closed', () => {
          mainWindow = null
        })
      })
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', (event) => {
    if (shutdownComplete) return
    event.preventDefault()
    void shutdown().finally(() => {
      shutdownComplete = true
      app.quit()
    })
  })
}
