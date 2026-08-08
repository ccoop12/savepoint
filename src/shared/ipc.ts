import type { CheckpointComparison } from './compare'
import type { ResumeSummary } from './resume'
import type {
  AppSettings,
  Checkpoint,
  CreateCheckpointRequest,
  GitSnapshot,
  IpcResult,
  ListCheckpointsInput,
  Repository,
  UpdateRepositoryInput,
  UpdateCheckpointInput
} from './schemas'

export interface ExportedCheckpoint {
  format: 'markdown' | 'json'
  content: string
  suggestedFileName: string
  canceled: boolean
  savedFileName?: string
}

export interface SavePointApi {
  repositories: {
    list: () => Promise<IpcResult<Repository[]>>
    selectAndRegister: () => Promise<IpcResult<Repository | null>>
    update: (input: UpdateRepositoryInput) => Promise<IpcResult<Repository>>
    refresh: (repositoryId: string) => Promise<IpcResult<GitSnapshot>>
  }
  checkpoints: {
    list: (input?: Partial<ListCheckpointsInput>) => Promise<IpcResult<Checkpoint[]>>
    create: (input: CreateCheckpointRequest) => Promise<IpcResult<Checkpoint>>
    update: (input: UpdateCheckpointInput) => Promise<IpcResult<Checkpoint>>
    delete: (checkpointId: string) => Promise<IpcResult<void>>
    compare: (
      baseCheckpointId: string,
      targetCheckpointId: string
    ) => Promise<IpcResult<CheckpointComparison>>
    export: (
      checkpointId: string,
      format: 'markdown' | 'json'
    ) => Promise<IpcResult<ExportedCheckpoint>>
    resume: (checkpointId: string) => Promise<IpcResult<ResumeSummary>>
  }
  settings: {
    get: () => Promise<IpcResult<AppSettings>>
    update: (input: Partial<AppSettings>) => Promise<IpcResult<AppSettings>>
  }
  events: {
    onCheckpointsChanged: (listener: () => void) => () => void
  }
  system: {
    openPath: (repositoryId: string) => Promise<IpcResult<void>>
    openInVSCode: (repositoryId: string) => Promise<IpcResult<void>>
    openExternal: (url: string) => Promise<IpcResult<void>>
    copyText: (text: string) => Promise<IpcResult<void>>
  }
}
