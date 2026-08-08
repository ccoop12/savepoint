import type {
  AppSettings as DomainSettings,
  Checkpoint as DomainCheckpoint,
  GitFile as DomainFile,
  GitSnapshot,
  IpcResult,
  Repository as DomainRepository,
  SavePointApi
} from '../../shared'

import { createDemoApi } from './demo-api'
import { resolveRendererRuntimeMode } from './runtime-mode'
import type {
  AppSnapshot,
  ChangedFile,
  Checkpoint,
  CheckpointDraft,
  ExportResult,
  FileStatus,
  Repository,
  SavePointRendererApi,
  Settings
} from './types'

type SavePointWindow = Window & { savepoint?: SavePointApi }

const nativeApi = (window as SavePointWindow).savepoint
export const rendererRuntimeMode = resolveRendererRuntimeMode(
  __SAVEPOINT_DEMO__,
  nativeApi !== undefined
)
export const isDemoMode = rendererRuntimeMode === 'demo'

const unwrap = <T>(result: IpcResult<T>): T => {
  if (result.ok) return result.value
  throw new Error(result.error.message)
}

const normalizeStatus = (status: DomainFile['status']): FileStatus => {
  if (
    status === 'modified' ||
    status === 'added' ||
    status === 'deleted' ||
    status === 'renamed' ||
    status === 'untracked'
  ) {
    return status
  }
  return status === 'ignored' ? 'untracked' : 'modified'
}

const toChangedFile = (file: DomainFile): ChangedFile => ({
  path: file.path,
  previousPath: file.previousPath ?? undefined,
  status: normalizeStatus(file.status),
  staged: file.staged,
  insertions: file.additions ?? undefined,
  deletions: file.deletions ?? undefined
})

const toCheckpoint = (checkpoint: DomainCheckpoint): Checkpoint => ({
  id: checkpoint.id,
  repositoryId: checkpoint.repositoryId,
  createdAt: checkpoint.createdAt,
  updatedAt: checkpoint.createdAt,
  origin: checkpoint.origin,
  title: checkpoint.context.title,
  goal: checkpoint.context.goal,
  completed: checkpoint.context.completed,
  nextAction: checkpoint.context.nextAction,
  blockers: checkpoint.context.blockers,
  notes: checkpoint.context.notes,
  tags: checkpoint.context.tags,
  urls: checkpoint.context.links,
  commands: checkpoint.context.commands,
  branch: checkpoint.git.branch,
  fullCommitHash: checkpoint.git.commitHash,
  shortCommitHash: checkpoint.git.shortCommitHash,
  isClean: checkpoint.git.isClean,
  files: checkpoint.git.files.map(toChangedFile),
  diffStats: checkpoint.git.diffStats,
  recentCommits: checkpoint.git.recentCommits.map((commit) => ({
    hash: commit.hash,
    shortHash: commit.shortHash,
    message: commit.subject,
    author: commit.authorName,
    authoredAt: commit.authoredAt
  }))
})

const emptySnapshot = (): GitSnapshot => ({
  branch: '(no checkpoint)',
  commitHash: '0000000',
  shortCommitHash: '0000000',
  isClean: true,
  files: [],
  counts: {
    staged: 0,
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    untracked: 0,
    conflicted: 0
  },
  diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
  recentCommits: []
})

const toRepository = (
  repository: DomainRepository,
  git: GitSnapshot,
  latest?: DomainCheckpoint
): Repository => ({
  id: repository.id,
  name: repository.name,
  path: repository.path,
  branch: git.branch,
  headCommit: git.commitHash,
  shortCommit: git.shortCommitHash,
  isClean: git.isClean,
  counts: {
    modified: git.counts.modified,
    added: git.counts.added,
    deleted: git.counts.deleted,
    renamed: git.counts.renamed,
    staged: git.counts.staged,
    untracked: git.counts.untracked
  },
  latestCheckpointAt: latest?.createdAt,
  latestGoal: latest?.context.goal,
  latestNextAction: latest?.context.nextAction,
  autoCheckpointEnabled: repository.autoCheckpointEnabled,
  autoCheckpointIntervalMinutes: repository.autoCheckpointIntervalMinutes,
  exclusionPatterns: repository.exclusionPatterns,
  createdAt: repository.createdAt
})

const toSettings = (settings: DomainSettings): Settings => ({
  theme: settings.theme,
  autoCheckpointMinutes: settings.defaultAutoCheckpointIntervalMinutes,
  exclusionPatterns: [],
  compactTimeline: false
})

const contextFromDraft = (draft: CheckpointDraft): DomainCheckpoint['context'] => ({
  title: draft.title,
  goal: draft.goal,
  completed: draft.completed,
  nextAction: draft.nextAction,
  blockers: draft.blockers,
  notes: draft.notes,
  tags: draft.tags,
  links: draft.urls,
  commands: draft.commands
})

class NativeRendererApi implements SavePointRendererApi {
  private readonly api: SavePointApi
  private repositories = new Map<string, DomainRepository>()
  private snapshots = new Map<string, GitSnapshot>()

  constructor(api: SavePointApi) {
    this.api = api
  }

  async load(): Promise<AppSnapshot> {
    const [repositoriesResult, checkpointsResult, settingsResult] = await Promise.all([
      this.api.repositories.list(),
      this.api.checkpoints.list(),
      this.api.settings.get()
    ])
    const repositories = unwrap(repositoriesResult)
    const domainCheckpoints = unwrap(checkpointsResult)
    const settings = unwrap(settingsResult)
    this.repositories = new Map(repositories.map((repository) => [repository.id, repository]))

    const statuses = await Promise.all(
      repositories.map(async (repository) => {
        const result = await this.api.repositories.refresh(repository.id)
        if (result.ok) return result.value
        const latest = domainCheckpoints.find(
          (checkpoint) => checkpoint.repositoryId === repository.id
        )
        return latest?.git ?? emptySnapshot()
      })
    )
    repositories.forEach((repository, index) => this.snapshots.set(repository.id, statuses[index]))

    return {
      repositories: repositories.map((repository, index) =>
        toRepository(
          repository,
          statuses[index],
          domainCheckpoints.find((checkpoint) => checkpoint.repositoryId === repository.id)
        )
      ),
      checkpoints: domainCheckpoints.map(toCheckpoint),
      settings: toSettings(settings)
    }
  }

  onCheckpointsChanged(listener: (checkpoints: Checkpoint[]) => void): () => void {
    return this.api.events.onCheckpointsChanged(() => {
      void this.api.checkpoints.list().then((result) => {
        if (result.ok) listener(result.value.map(toCheckpoint))
      })
    })
  }

  async selectRepository(): Promise<{
    repository?: Repository
    canceled?: boolean
    error?: string
  }> {
    const registered = unwrap(await this.api.repositories.selectAndRegister())
    if (!registered) return { canceled: true }
    this.repositories.set(registered.id, registered)
    const git = unwrap(await this.api.repositories.refresh(registered.id))
    this.snapshots.set(registered.id, git)
    return { repository: toRepository(registered, git) }
  }

  async refreshRepository(repositoryId: string): Promise<Repository> {
    const git = unwrap(await this.api.repositories.refresh(repositoryId))
    this.snapshots.set(repositoryId, git)
    const repository = this.repositories.get(repositoryId)
    if (!repository) throw new Error('Repository not found')
    return toRepository(repository, git)
  }

  async createCheckpoint(repositoryId: string, draft: CheckpointDraft): Promise<Checkpoint> {
    const checkpoint = unwrap(
      await this.api.checkpoints.create({
        repositoryId,
        context: contextFromDraft(draft)
      })
    )
    this.snapshots.set(repositoryId, checkpoint.git)
    return toCheckpoint(checkpoint)
  }

  async updateCheckpoint(checkpointId: string, draft: CheckpointDraft): Promise<Checkpoint> {
    return toCheckpoint(
      unwrap(
        await this.api.checkpoints.update({ id: checkpointId, context: contextFromDraft(draft) })
      )
    )
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    unwrap(await this.api.checkpoints.delete(checkpointId))
  }

  async exportCheckpoint(checkpointId: string, format: 'markdown' | 'json'): Promise<ExportResult> {
    const exported = unwrap(await this.api.checkpoints.export(checkpointId, format))
    if (exported.canceled) return { canceled: true }
    return {
      canceled: false,
      path: exported.savedFileName ?? exported.suggestedFileName,
      content: exported.content
    }
  }

  async resumeCheckpoint(checkpointId: string) {
    return unwrap(await this.api.checkpoints.resume(checkpointId))
  }

  async updateSettings(settings: Settings, repositoryId?: string): Promise<Settings> {
    const updated = unwrap(
      await this.api.settings.update({
        theme: settings.theme,
        defaultAutoCheckpointIntervalMinutes: settings.autoCheckpointMinutes
      })
    )
    const repository = repositoryId
      ? this.repositories.get(repositoryId)
      : [...this.repositories.values()][0]
    if (repository) {
      const updatedRepository = unwrap(
        await this.api.repositories.update({
          id: repository.id,
          exclusionPatterns: settings.exclusionPatterns,
          autoCheckpointIntervalMinutes: settings.autoCheckpointMinutes
        })
      )
      this.repositories.set(repository.id, updatedRepository)
    }
    return { ...settings, theme: updated.theme }
  }

  async setAutoCheckpoint(repositoryId: string, enabled: boolean): Promise<Repository> {
    const updated = unwrap(
      await this.api.repositories.update({ id: repositoryId, autoCheckpointEnabled: enabled })
    )
    this.repositories.set(repositoryId, updated)
    return toRepository(updated, this.snapshots.get(repositoryId) ?? emptySnapshot())
  }

  async openRepository(repositoryId: string, target: 'folder' | 'vscode'): Promise<void> {
    const result =
      target === 'vscode'
        ? await this.api.system.openInVSCode(repositoryId)
        : await this.api.system.openPath(repositoryId)
    unwrap(result)
  }

  async openExternal(url: string): Promise<void> {
    unwrap(await this.api.system.openExternal(url))
  }

  async copyText(text: string): Promise<void> {
    unwrap(await this.api.system.copyText(text))
  }
}

let rendererApi: SavePointRendererApi | undefined

export const getRendererApi = (): SavePointRendererApi => {
  if (rendererRuntimeMode === 'initialization-error') {
    throw new Error('The secure SavePoint desktop bridge did not initialize.')
  }
  if (rendererRuntimeMode === 'demo') rendererApi ??= createDemoApi()
  else {
    if (!nativeApi) throw new Error('The secure SavePoint desktop bridge did not initialize.')
    rendererApi ??= new NativeRendererApi(nativeApi)
  }
  return rendererApi
}
