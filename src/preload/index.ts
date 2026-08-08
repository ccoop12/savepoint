import { contextBridge, ipcRenderer } from 'electron'

import {
  IPC_CHANNELS,
  type AppSettings,
  type Checkpoint,
  type CheckpointComparison,
  type CreateCheckpointRequest,
  type ExportedCheckpoint,
  type GitSnapshot,
  type IpcResult,
  type ListCheckpointsInput,
  type Repository,
  type ResumeSummary,
  type SavePointApi,
  type UpdateCheckpointInput,
  type UpdateRepositoryInput
} from '../shared'

async function invoke<T>(channel: string, input?: unknown): Promise<IpcResult<T>> {
  const value: unknown = await ipcRenderer.invoke(channel, input)
  return value as IpcResult<T>
}

const api: SavePointApi = {
  repositories: {
    list: () => invoke<Repository[]>(IPC_CHANNELS.repositoriesList),
    selectAndRegister: () => invoke<Repository | null>(IPC_CHANNELS.repositoriesSelectAndRegister),
    update: (input: UpdateRepositoryInput) =>
      invoke<Repository>(IPC_CHANNELS.repositoriesUpdate, input),
    refresh: (repositoryId: string) =>
      invoke<GitSnapshot>(IPC_CHANNELS.repositoriesRefresh, { repositoryId })
  },
  checkpoints: {
    list: (input: Partial<ListCheckpointsInput> = {}) =>
      invoke<Checkpoint[]>(IPC_CHANNELS.checkpointsList, input),
    create: (input: CreateCheckpointRequest) =>
      invoke<Checkpoint>(IPC_CHANNELS.checkpointsCreate, input),
    update: (input: UpdateCheckpointInput) =>
      invoke<Checkpoint>(IPC_CHANNELS.checkpointsUpdate, input),
    delete: (checkpointId: string) =>
      invoke<void>(IPC_CHANNELS.checkpointsDelete, { checkpointId }),
    compare: (baseCheckpointId: string, targetCheckpointId: string) =>
      invoke<CheckpointComparison>(IPC_CHANNELS.checkpointsCompare, {
        baseCheckpointId,
        targetCheckpointId
      }),
    export: (checkpointId: string, format: 'markdown' | 'json') =>
      invoke<ExportedCheckpoint>(IPC_CHANNELS.checkpointsExport, { checkpointId, format }),
    resume: (checkpointId: string) =>
      invoke<ResumeSummary>(IPC_CHANNELS.checkpointsResume, { checkpointId })
  },
  settings: {
    get: () => invoke<AppSettings>(IPC_CHANNELS.settingsGet),
    update: (input: Partial<AppSettings>) => invoke<AppSettings>(IPC_CHANNELS.settingsUpdate, input)
  },
  events: {
    onCheckpointsChanged: (listener: () => void) => {
      const handler = (): void => listener()
      ipcRenderer.on(IPC_CHANNELS.checkpointsChanged, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.checkpointsChanged, handler)
    }
  },
  system: {
    openPath: (repositoryId: string) => invoke<void>(IPC_CHANNELS.systemOpenPath, { repositoryId }),
    openInVSCode: (repositoryId: string) =>
      invoke<void>(IPC_CHANNELS.systemOpenInVSCode, { repositoryId }),
    openExternal: (url: string) => invoke<void>(IPC_CHANNELS.systemOpenExternal, { url }),
    copyText: (text: string) => invoke<void>(IPC_CHANNELS.systemCopyText, { text })
  }
}

contextBridge.exposeInMainWorld('savepoint', Object.freeze(api))

declare global {
  interface Window {
    readonly savepoint: SavePointApi
  }
}
