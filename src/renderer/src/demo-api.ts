import type { ResumeSummary } from '../../shared'

import { demoSnapshot } from './demo-data'
import type {
  AppSnapshot,
  Checkpoint,
  CheckpointDraft,
  ExportResult,
  Repository,
  SavePointRendererApi,
  Settings
} from './types'

const clone = <T>(value: T): T => structuredClone(value)

const checkpointMarkdown = (
  checkpoint: Checkpoint,
  repository?: Repository
): string => `# ${checkpoint.title}

> SavePoint checkpoint · ${new Date(checkpoint.createdAt).toLocaleString()}

## Context

- **Repository:** ${repository?.name ?? checkpoint.repositoryId}
- **Branch:** \`${checkpoint.branch}\`
- **Commit:** \`${checkpoint.shortCommitHash}\`
- **Goal:** ${checkpoint.goal}
- **Next action:** ${checkpoint.nextAction}

## Completed

${checkpoint.completed || 'Nothing recorded.'}

## Blockers

${checkpoint.blockers || 'None recorded.'}

## Changed files

${checkpoint.files.map((file) => `- ${file.status}: \`${file.path}\`${file.staged ? ' (staged)' : ''}`).join('\n') || '- Working tree was clean.'}

## Notes

${checkpoint.notes || 'None recorded.'}
`

const makeFreshSnapshot = (): AppSnapshot => ({
  repositories: [],
  checkpoints: [],
  settings: clone(demoSnapshot.settings)
})

class DemoSavePointApi implements SavePointRendererApi {
  private state: AppSnapshot

  constructor() {
    const isFresh = new URLSearchParams(window.location.search).has('fresh')
    this.state = isFresh ? makeFreshSnapshot() : clone(demoSnapshot)
  }

  async load(): Promise<AppSnapshot> {
    await Promise.resolve()
    return clone(this.state)
  }

  onCheckpointsChanged(_listener: (checkpoints: Checkpoint[]) => void): () => void {
    void _listener
    return () => undefined
  }

  async selectRepository(): Promise<{ repository: Repository }> {
    await new Promise((resolve) => window.setTimeout(resolve, 320))
    const existing = this.state.repositories.find((item) => item.id === 'repo-pixel-forge')
    if (existing) return { repository: clone(existing) }

    const repository: Repository = {
      id: 'repo-pixel-forge',
      name: 'pixel-forge',
      path: '/workspace/pixel-forge',
      branch: 'feature/canvas-export',
      headCommit: 'c7a4e081a3fe3d413aeb7537db7a6218f2a88bb1',
      shortCommit: 'c7a4e08',
      isClean: false,
      counts: { modified: 2, added: 1, deleted: 0, renamed: 0, staged: 1, untracked: 0 },
      latestGoal: '',
      latestNextAction: '',
      autoCheckpointEnabled: false,
      autoCheckpointIntervalMinutes: this.state.settings.autoCheckpointMinutes,
      exclusionPatterns: [...this.state.settings.exclusionPatterns],
      createdAt: new Date().toISOString()
    }
    this.state.repositories.push(repository)
    return { repository: clone(repository) }
  }

  async refreshRepository(repositoryId: string): Promise<Repository> {
    await new Promise((resolve) => window.setTimeout(resolve, 220))
    const repository = this.requireRepository(repositoryId)
    return clone(repository)
  }

  async createCheckpoint(repositoryId: string, draft: CheckpointDraft): Promise<Checkpoint> {
    await Promise.resolve()
    const repository = this.requireRepository(repositoryId)
    const now = new Date().toISOString()
    const checkpoint: Checkpoint = {
      id: `cp-${Date.now()}`,
      repositoryId,
      createdAt: now,
      updatedAt: now,
      origin: 'manual',
      ...clone(draft),
      branch: repository.branch,
      fullCommitHash: repository.headCommit,
      shortCommitHash: repository.shortCommit,
      isClean: repository.isClean,
      files: repository.isClean
        ? []
        : [
            {
              path: 'src/export/canvas-writer.ts',
              status: 'modified',
              staged: true,
              insertions: 31,
              deletions: 8
            },
            {
              path: 'src/export/export-dialog.tsx',
              status: 'modified',
              staged: false,
              insertions: 22,
              deletions: 5
            },
            {
              path: 'tests/export/canvas.test.ts',
              status: 'added',
              staged: false,
              insertions: 44,
              deletions: 0
            }
          ],
      diffStats: repository.isClean
        ? { filesChanged: 0, insertions: 0, deletions: 0 }
        : { filesChanged: 3, insertions: 97, deletions: 13 },
      recentCommits: [
        {
          hash: repository.headCommit,
          shortHash: repository.shortCommit,
          message: 'feat(export): add canvas rendering pipeline',
          author: 'Demo Developer',
          authoredAt: now
        }
      ]
    }
    this.state.checkpoints.unshift(checkpoint)
    repository.latestCheckpointAt = now
    repository.latestGoal = checkpoint.goal
    repository.latestNextAction = checkpoint.nextAction
    return clone(checkpoint)
  }

  async updateCheckpoint(checkpointId: string, draft: CheckpointDraft): Promise<Checkpoint> {
    await Promise.resolve()
    const checkpoint = this.requireCheckpoint(checkpointId)
    Object.assign(checkpoint, clone(draft), { updatedAt: new Date().toISOString() })
    return clone(checkpoint)
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    await Promise.resolve()
    const index = this.state.checkpoints.findIndex((item) => item.id === checkpointId)
    if (index < 0) throw new Error('Checkpoint not found')
    this.state.checkpoints.splice(index, 1)
  }

  async exportCheckpoint(checkpointId: string, format: 'markdown' | 'json'): Promise<ExportResult> {
    await Promise.resolve()
    const checkpoint = this.requireCheckpoint(checkpointId)
    const repository = this.state.repositories.find((item) => item.id === checkpoint.repositoryId)
    const content =
      format === 'markdown'
        ? checkpointMarkdown(checkpoint, repository)
        : JSON.stringify(checkpoint, null, 2)
    const fileName = `${checkpoint.id}.${format === 'markdown' ? 'md' : 'json'}`
    const blob = new Blob([content], {
      type: format === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8'
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    return { path: fileName, content }
  }

  async resumeCheckpoint(checkpointId: string): Promise<ResumeSummary> {
    await Promise.resolve()
    const checkpoint = this.requireCheckpoint(checkpointId)
    const repository = this.requireRepository(checkpoint.repositoryId)
    const latest = this.state.checkpoints.find(
      (item) => item.repositoryId === checkpoint.repositoryId
    )
    const currentFiles = [
      ...(latest?.files.filter((file) => file.path !== 'src/sync/legacy-buffer.ts') ?? []),
      ...(repository.id === 'repo-orbit-notes'
        ? [
            {
              path: 'src/sync/reconnect-policy.ts',
              status: 'added' as const,
              staged: false,
              insertions: 28,
              deletions: 0
            }
          ]
        : [])
    ]
    const checkpointPaths = new Set(checkpoint.files.map((file) => file.path))
    const currentPaths = new Set(currentFiles.map((file) => file.path))
    const branchChanged = repository.branch !== checkpoint.branch
    const commitChanged = repository.headCommit !== checkpoint.fullCommitHash
    const currentStateDifference = {
      branchChanged,
      commitChanged,
      cleanStateChanged: repository.isClean !== checkpoint.isClean,
      checkpointBranch: checkpoint.branch,
      currentBranch: repository.branch,
      checkpointCommit: checkpoint.fullCommitHash,
      currentCommit: repository.headCommit,
      filesAddedSinceCheckpoint: [...currentPaths]
        .filter((path) => !checkpointPaths.has(path))
        .sort(),
      filesRemovedSinceCheckpoint: [...checkpointPaths]
        .filter((path) => !currentPaths.has(path))
        .sort(),
      filesChangedSinceCheckpoint:
        commitChanged && currentPaths.has('src/sync/mutation-queue.ts')
          ? ['src/sync/mutation-queue.ts']
          : []
    }
    const markdown = `${checkpointMarkdown(checkpoint, repository)}
## Repository now

- Branch: \`${repository.branch}\`${branchChanged ? ` (was \`${checkpoint.branch}\`)` : ''}
- Commit: \`${repository.shortCommit}\`${commitChanged ? ` (was \`${checkpoint.shortCommitHash}\`)` : ''}
- File-set drift: +${currentStateDifference.filesAddedSinceCheckpoint.length} / -${currentStateDifference.filesRemovedSinceCheckpoint.length} / ~${currentStateDifference.filesChangedSinceCheckpoint.length}
`
    const assistantContext = [
      `Resume development checkpoint "${checkpoint.title}".`,
      `Goal: ${checkpoint.goal}`,
      `Completed: ${checkpoint.completed || 'Not recorded.'}`,
      `Next: ${checkpoint.nextAction}`,
      `Blockers: ${checkpoint.blockers || 'None.'}`,
      `Git: branch ${checkpoint.branch}, commit ${checkpoint.shortCommitHash}.`,
      commitChanged
        ? `Current repository: branch ${repository.branch}, commit ${repository.shortCommit}.`
        : ''
    ]
      .filter(Boolean)
      .join('\n')

    return {
      checkpointId: checkpoint.id,
      title: checkpoint.title,
      capturedAt: checkpoint.createdAt,
      whatYouWereDoing: checkpoint.goal,
      completed: checkpoint.completed,
      remains: checkpoint.nextAction,
      nextRecommendedAction: checkpoint.nextAction,
      blockers: checkpoint.blockers || 'No blockers recorded.',
      notes: checkpoint.notes,
      branch: checkpoint.branch,
      commitHash: checkpoint.fullCommitHash,
      changedFiles: checkpoint.files.map(({ path, status, staged }) => ({
        path,
        status,
        staged
      })),
      commands: checkpoint.commands,
      links: checkpoint.urls,
      checkoutCommand: /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(checkpoint.branch)
        ? `git switch -- ${checkpoint.branch}`
        : null,
      currentStateDifference,
      markdown,
      assistantContext
    }
  }

  async updateSettings(settings: Settings, repositoryId?: string): Promise<Settings> {
    await Promise.resolve()
    if (repositoryId) {
      const repository = this.requireRepository(repositoryId)
      repository.autoCheckpointIntervalMinutes = settings.autoCheckpointMinutes
      repository.exclusionPatterns = [...settings.exclusionPatterns]
    }
    this.state.settings = clone(settings)
    return clone(settings)
  }

  async setAutoCheckpoint(repositoryId: string, enabled: boolean): Promise<Repository> {
    await Promise.resolve()
    const repository = this.requireRepository(repositoryId)
    repository.autoCheckpointEnabled = enabled
    return clone(repository)
  }

  async openRepository(_repositoryId: string, _target: 'folder' | 'vscode'): Promise<void> {
    void _repositoryId
    void _target
    await Promise.resolve()
  }

  async openExternal(_url: string): Promise<void> {
    void _url
    await Promise.resolve()
  }

  async copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard access is optional in controlled browser mode.
    }
  }

  private requireRepository(repositoryId: string): Repository {
    const repository = this.state.repositories.find((item) => item.id === repositoryId)
    if (!repository) throw new Error('Repository not found')
    return repository
  }

  private requireCheckpoint(checkpointId: string): Checkpoint {
    const checkpoint = this.state.checkpoints.find((item) => item.id === checkpointId)
    if (!checkpoint) throw new Error('Checkpoint not found')
    return checkpoint
  }
}

export const createDemoApi = (): SavePointRendererApi => new DemoSavePointApi()
