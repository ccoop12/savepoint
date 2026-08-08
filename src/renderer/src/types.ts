export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
export type CheckpointOrigin = 'manual' | 'automatic'
export type ThemePreference = 'dark' | 'light' | 'system'

export interface FileCounts {
  modified: number
  added: number
  deleted: number
  renamed: number
  staged: number
  untracked: number
}

export interface ChangedFile {
  path: string
  previousPath?: string
  status: FileStatus
  staged: boolean
  insertions?: number
  deletions?: number
}

export interface RecentCommit {
  hash: string
  shortHash: string
  message: string
  author: string
  authoredAt: string
}

export interface Repository {
  id: string
  name: string
  path: string
  branch: string
  headCommit: string
  shortCommit: string
  isClean: boolean
  counts: FileCounts
  latestCheckpointAt?: string
  latestGoal?: string
  latestNextAction?: string
  autoCheckpointEnabled: boolean
  autoCheckpointIntervalMinutes: number
  exclusionPatterns: string[]
  createdAt: string
}

export interface Checkpoint {
  id: string
  repositoryId: string
  createdAt: string
  updatedAt: string
  origin: CheckpointOrigin
  title: string
  goal: string
  completed: string
  nextAction: string
  blockers: string
  notes: string
  tags: string[]
  urls: string[]
  commands: string[]
  branch: string
  fullCommitHash: string
  shortCommitHash: string
  isClean: boolean
  files: ChangedFile[]
  diffStats: {
    filesChanged: number
    insertions: number
    deletions: number
  }
  recentCommits: RecentCommit[]
}

export interface CheckpointDraft {
  title: string
  goal: string
  completed: string
  nextAction: string
  blockers: string
  notes: string
  tags: string[]
  urls: string[]
  commands: string[]
}

export interface Settings {
  theme: ThemePreference
  autoCheckpointMinutes: number
  exclusionPatterns: string[]
  compactTimeline: boolean
}

export interface AppSnapshot {
  repositories: Repository[]
  checkpoints: Checkpoint[]
  settings: Settings
}

export interface RepositorySelection {
  repository?: Repository
  canceled?: boolean
  error?: string
}

export interface ExportResult {
  canceled?: boolean
  path?: string
  content?: string
}

export interface SavePointRendererApi {
  load(): Promise<AppSnapshot>
  onCheckpointsChanged(listener: (checkpoints: Checkpoint[]) => void): () => void
  selectRepository(): Promise<RepositorySelection>
  refreshRepository(repositoryId: string): Promise<Repository>
  createCheckpoint(repositoryId: string, draft: CheckpointDraft): Promise<Checkpoint>
  updateCheckpoint(checkpointId: string, draft: CheckpointDraft): Promise<Checkpoint>
  deleteCheckpoint(checkpointId: string): Promise<void>
  exportCheckpoint(checkpointId: string, format: 'markdown' | 'json'): Promise<ExportResult>
  resumeCheckpoint(checkpointId: string): Promise<ResumeSummary>
  updateSettings(settings: Settings, repositoryId?: string): Promise<Settings>
  setAutoCheckpoint(repositoryId: string, enabled: boolean): Promise<Repository>
  openRepository(repositoryId: string, target: 'folder' | 'vscode'): Promise<void>
  openExternal(url: string): Promise<void>
  copyText(text: string): Promise<void>
}

export type AppView = 'dashboard' | 'timeline' | 'compare' | 'resume' | 'privacy' | 'settings'
import type { ResumeSummary } from '../../shared'

export type { ResumeSummary } from '../../shared'
