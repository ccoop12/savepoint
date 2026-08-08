import { spawn, type ChildProcess } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import {
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type SaveDialogOptions
} from 'electron'
import { ZodError, type ZodType } from 'zod'

import {
  IPC_CHANNELS,
  checkpointIdInputSchema,
  compareCheckpointsInputSchema,
  copyTextInputSchema,
  createCheckpointRequestSchema,
  exportCheckpointInputSchema,
  listCheckpointsInputSchema,
  openExternalInputSchema,
  repositoryIdInputSchema,
  updateCheckpointInputSchema,
  updateRepositoryInputSchema,
  updateSettingsInputSchema,
  type IpcError,
  type IpcResult
} from '../shared'
import { CaptureLimitError, InvalidRepositoryError } from './services/git-capture'
import { ResourceNotFoundError, SavePointService } from './services/savepoint-service'

export interface IpcRegistrationOptions {
  readonly getWindow: () => BrowserWindow | null
}

class SafeActionError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'SafeActionError'
  }
}

function parse<T>(schema: ZodType<T>, input: unknown): T {
  return schema.parse(input)
}

function ipcError(error: unknown): IpcError {
  if (error instanceof ZodError) {
    return {
      code: 'INVALID_INPUT',
      message: 'The request contained invalid data.',
      details: {
        issues: error.issues.map(({ path, message }) => ({ path: path.join('.'), message }))
      }
    }
  }
  if (
    error instanceof InvalidRepositoryError ||
    error instanceof CaptureLimitError ||
    error instanceof ResourceNotFoundError
  ) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof SafeActionError) return { code: error.code, message: error.message }
  return { code: 'INTERNAL_ERROR', message: 'SavePoint could not complete that request.' }
}

async function result<T>(operation: () => T | Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error: unknown) {
    return { ok: false, error: ipcError(error) }
  }
}

function isTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow | null): boolean {
  return Boolean(
    window &&
    !window.isDestroyed() &&
    event.sender.id === window.webContents.id &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url === window.webContents.getURL()
  )
}

function assertTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow | null): void {
  if (!isTrustedSender(event, window)) {
    throw new SafeActionError('UNTRUSTED_SENDER', 'The request did not come from SavePoint.')
  }
}

function registeredPath(service: SavePointService, input: unknown): string {
  const { repositoryId } = parse(repositoryIdInputSchema, input)
  const repository = service.database.getRepository(repositoryId)
  if (!repository) {
    throw new SafeActionError(
      'REPOSITORY_NOT_REGISTERED',
      'Only a registered repository folder can be opened.'
    )
  }
  return repository.path
}

async function openRegisteredPath(service: SavePointService, input: unknown): Promise<void> {
  const path = registeredPath(service, input)
  const failure = await shell.openPath(path)
  if (failure)
    throw new SafeActionError('OPEN_PATH_FAILED', 'The repository folder could not be opened.')
}

function spawnAndWait(command: string, args: readonly string[]): Promise<ChildProcess> {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, [...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolveProcess(child)
    })
  })
}

function vsCodeCandidates(): string[] {
  if (process.platform === 'darwin') {
    return ['/Applications/Visual Studio Code.app/Contents/MacOS/Electron']
  }
  if (process.platform === 'linux') {
    return ['/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code']
  }
  const localAppData = process.env.LOCALAPPDATA
  const programFiles = process.env.ProgramFiles
  const programFilesX86 = process.env['ProgramFiles(x86)']
  return [
    localAppData ? join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe') : '',
    programFiles ? join(programFiles, 'Microsoft VS Code', 'Code.exe') : '',
    programFilesX86 ? join(programFilesX86, 'Microsoft VS Code', 'Code.exe') : ''
  ].filter(Boolean)
}

async function openRegisteredPathInVSCode(
  service: SavePointService,
  input: unknown
): Promise<void> {
  const path = registeredPath(service, input)
  for (const executable of vsCodeCandidates()) {
    try {
      await spawnAndWait(executable, ['--reuse-window', path])
      return
    } catch {
      // Continue through fixed, known executable candidates only.
    }
  }
  throw new SafeActionError(
    'VSCODE_UNAVAILABLE',
    'Visual Studio Code is not installed or its command is unavailable.'
  )
}

async function openSafeExternal(input: unknown, window: BrowserWindow | null): Promise<void> {
  const { url } = parse(openExternalInputSchema, input)
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new SafeActionError('UNSAFE_URL', 'SavePoint only opens credential-free HTTPS links.')
  }
  const normalizedUrl = parsed.toString()
  const confirmationOptions = {
    type: 'question' as const,
    title: 'Open external link?',
    message: `Open a link on ${parsed.hostname}?`,
    detail: normalizedUrl,
    buttons: ['Cancel', 'Open link'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  }
  const confirmation = window
    ? await dialog.showMessageBox(window, confirmationOptions)
    : await dialog.showMessageBox(confirmationOptions)
  if (confirmation.response !== 1) return
  await shell.openExternal(normalizedUrl, { activate: true })
}

async function saveExport(
  service: SavePointService,
  window: BrowserWindow | null,
  input: unknown
): Promise<ReturnType<SavePointService['exportCheckpoint']>> {
  const { checkpointId, format } = parse(exportCheckpointInputSchema, input)
  const exported = service.exportCheckpoint(checkpointId, format)
  const options: SaveDialogOptions = {
    title: `Export checkpoint as ${format === 'markdown' ? 'Markdown' : 'JSON'}`,
    defaultPath: exported.suggestedFileName,
    filters:
      format === 'markdown'
        ? [{ name: 'Markdown', extensions: ['md'] }]
        : [{ name: 'JSON', extensions: ['json'] }],
    properties: ['showOverwriteConfirmation', 'createDirectory']
  }
  const selection = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (selection.canceled || !selection.filePath) return { ...exported, canceled: true }
  await writeFile(selection.filePath, exported.content, { encoding: 'utf8', mode: 0o600 })
  return { ...exported, canceled: false, savedFileName: basename(selection.filePath) }
}

export function registerIpcHandlers(
  service: SavePointService,
  options: IpcRegistrationOptions
): () => void {
  const channels = Object.values(IPC_CHANNELS)
  for (const channel of channels) ipcMain.removeHandler(channel)

  const handle = <T>(
    channel: string,
    operation: (input: unknown, event: IpcMainInvokeEvent) => T | Promise<T>
  ): void => {
    ipcMain.handle(channel, (event, input: unknown) =>
      result(() => {
        assertTrustedSender(event, options.getWindow())
        return operation(input, event)
      })
    )
  }

  handle(IPC_CHANNELS.repositoriesList, () => service.listRepositories())
  handle(IPC_CHANNELS.repositoriesSelectAndRegister, async () => {
    const window = options.getWindow()
    const selection = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    const path = selection.canceled ? undefined : selection.filePaths[0]
    return path ? service.registerRepository({ path }) : null
  })
  handle(IPC_CHANNELS.repositoriesUpdate, (input) =>
    service.updateRepository(parse(updateRepositoryInputSchema, input))
  )
  handle(IPC_CHANNELS.repositoriesRefresh, (input) => {
    const { repositoryId } = parse(repositoryIdInputSchema, input)
    return service.refreshRepository(repositoryId)
  })
  handle(IPC_CHANNELS.checkpointsList, (input) =>
    service.listCheckpoints(parse(listCheckpointsInputSchema, input ?? {}))
  )
  handle(IPC_CHANNELS.checkpointsCreate, (input) =>
    service.createCheckpoint(parse(createCheckpointRequestSchema, input))
  )
  handle(IPC_CHANNELS.checkpointsUpdate, (input) =>
    service.updateCheckpoint(parse(updateCheckpointInputSchema, input))
  )
  handle(IPC_CHANNELS.checkpointsDelete, async (input) => {
    const { checkpointId } = parse(checkpointIdInputSchema, input)
    await service.deleteCheckpoint(checkpointId)
  })
  handle(IPC_CHANNELS.checkpointsCompare, (input) => {
    const { baseCheckpointId, targetCheckpointId } = parse(compareCheckpointsInputSchema, input)
    return service.compare(baseCheckpointId, targetCheckpointId)
  })
  handle(IPC_CHANNELS.checkpointsExport, (input) => saveExport(service, options.getWindow(), input))
  handle(IPC_CHANNELS.checkpointsResume, (input) => {
    const { checkpointId } = parse(checkpointIdInputSchema, input)
    return service.resume(checkpointId)
  })

  handle(IPC_CHANNELS.settingsGet, () => service.getSettings())
  handle(IPC_CHANNELS.settingsUpdate, (input) =>
    service.updateSettings(parse(updateSettingsInputSchema, input))
  )
  handle(IPC_CHANNELS.systemOpenPath, (input) => openRegisteredPath(service, input))
  handle(IPC_CHANNELS.systemOpenInVSCode, (input) => openRegisteredPathInVSCode(service, input))
  handle(IPC_CHANNELS.systemOpenExternal, (input) => openSafeExternal(input, options.getWindow()))
  handle(IPC_CHANNELS.systemCopyText, (input) => {
    const { text } = parse(copyTextInputSchema, input)
    clipboard.writeText(text)
  })

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
