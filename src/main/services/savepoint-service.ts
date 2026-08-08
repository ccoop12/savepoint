import {
  compareCheckpoints,
  createCheckpointRequestSchema,
  exportCheckpointJson,
  exportCheckpointMarkdown,
  generateResumeSummary,
  listCheckpointsInputSchema,
  registerRepositoryInputSchema,
  updateCheckpointInputSchema,
  updateRepositoryInputSchema,
  updateSettingsInputSchema,
  type AppSettings,
  type Checkpoint,
  type CheckpointComparison,
  type CreateCheckpointRequest,
  type ExportedCheckpoint,
  type GitSnapshot,
  type ListCheckpointsInput,
  type Repository,
  type ResumeSummary,
  type UpdateCheckpointInput,
  type UpdateRepositoryInput
} from '../../shared'
import { AutoCheckpointManager } from './auto-checkpoint-manager'
import { SavePointDatabase } from './database/database'
import { GitCaptureService } from './git-capture'

export class ResourceNotFoundError extends Error {
  readonly code = 'NOT_FOUND'

  constructor(resource: 'Repository' | 'Checkpoint') {
    super(`${resource} not found`)
    this.name = 'ResourceNotFoundError'
  }
}

function exportFileName(checkpoint: Checkpoint, format: 'markdown' | 'json'): string {
  const rawTitle = checkpoint.context.title || `checkpoint-${checkpoint.git.shortCommitHash}`
  const safeTitle = rawTitle
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${safeTitle || 'savepoint-checkpoint'}.${format === 'markdown' ? 'md' : 'json'}`
}

export class SavePointService {
  constructor(
    readonly database: SavePointDatabase,
    readonly git: GitCaptureService,
    readonly autoCheckpoints?: AutoCheckpointManager
  ) {}

  listRepositories(): Repository[] {
    return this.database.listRepositories()
  }

  async registerRepository(rawInput: { path: string }): Promise<Repository> {
    const input = registerRepositoryInputSchema.parse(rawInput)
    const resolved = await this.git.resolveRepository(input.path)
    const existing = this.database.findRepositoryByPath(resolved.path)
    if (existing) return existing
    const repository = await this.database.registerRepository(resolved.path, resolved.name)
    const defaultInterval = this.database.getSettings().defaultAutoCheckpointIntervalMinutes
    if (repository.autoCheckpointIntervalMinutes === defaultInterval) return repository
    return this.database.updateRepository({
      id: repository.id,
      autoCheckpointIntervalMinutes: defaultInterval
    })
  }

  async updateRepository(rawInput: UpdateRepositoryInput): Promise<Repository> {
    const input = updateRepositoryInputSchema.parse(rawInput)
    if (!this.database.getRepository(input.id)) throw new ResourceNotFoundError('Repository')
    const repository = await this.database.updateRepository(input)
    this.autoCheckpoints?.sync()
    return repository
  }

  async removeRepository(repositoryId: string): Promise<void> {
    this.autoCheckpoints?.stop(repositoryId)
    if (!(await this.database.removeRepository(repositoryId))) {
      throw new ResourceNotFoundError('Repository')
    }
  }

  async refreshRepository(repositoryId: string): Promise<GitSnapshot> {
    const repository = this.database.getRepository(repositoryId)
    if (!repository) throw new ResourceNotFoundError('Repository')
    return this.git.capture(repository.path, { exclusionPatterns: repository.exclusionPatterns })
  }

  listCheckpoints(rawInput: Partial<ListCheckpointsInput> = {}): Checkpoint[] {
    return this.database.listCheckpoints(listCheckpointsInputSchema.parse(rawInput))
  }

  async createCheckpoint(rawInput: CreateCheckpointRequest): Promise<Checkpoint> {
    const input = createCheckpointRequestSchema.parse(rawInput)
    const repository = this.database.getRepository(input.repositoryId)
    if (!repository) throw new ResourceNotFoundError('Repository')

    // The renderer supplies its last preview for type symmetry, but the trusted
    // main process always captures fresh Git state at the moment of creation.
    const git = await this.git.capture(repository.path, {
      exclusionPatterns: repository.exclusionPatterns
    })
    return this.database.createCheckpoint({ ...input, origin: 'manual', git })
  }

  async updateCheckpoint(rawInput: UpdateCheckpointInput): Promise<Checkpoint> {
    const input = updateCheckpointInputSchema.parse(rawInput)
    if (!this.database.getCheckpoint(input.id)) throw new ResourceNotFoundError('Checkpoint')
    return this.database.updateCheckpoint(input)
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    if (!(await this.database.deleteCheckpoint(checkpointId))) {
      throw new ResourceNotFoundError('Checkpoint')
    }
  }

  compare(baseCheckpointId: string, targetCheckpointId: string): CheckpointComparison {
    const base = this.database.getCheckpoint(baseCheckpointId)
    const target = this.database.getCheckpoint(targetCheckpointId)
    if (!base || !target) throw new ResourceNotFoundError('Checkpoint')
    return compareCheckpoints(base, target)
  }

  exportCheckpoint(checkpointId: string, format: 'markdown' | 'json'): ExportedCheckpoint {
    const checkpoint = this.database.getCheckpoint(checkpointId)
    if (!checkpoint) throw new ResourceNotFoundError('Checkpoint')
    const repository = this.database.getRepository(checkpoint.repositoryId)
    const content =
      format === 'markdown'
        ? exportCheckpointMarkdown(checkpoint, { repositoryName: repository?.name })
        : exportCheckpointJson(checkpoint, { repositoryName: repository?.name })
    return {
      format,
      content,
      suggestedFileName: exportFileName(checkpoint, format),
      canceled: false
    }
  }

  async resume(checkpointId: string): Promise<ResumeSummary> {
    const checkpoint = this.database.getCheckpoint(checkpointId)
    if (!checkpoint) throw new ResourceNotFoundError('Checkpoint')
    const repository = this.database.getRepository(checkpoint.repositoryId)
    let current: GitSnapshot | null = null
    if (repository) {
      try {
        current = await this.git.capture(repository.path, {
          exclusionPatterns: repository.exclusionPatterns
        })
      } catch {
        // A moved/unavailable repository should not make saved context unusable.
      }
    }
    return generateResumeSummary(checkpoint, current)
  }

  getSettings(): AppSettings {
    return this.database.getSettings()
  }

  async updateSettings(rawInput: Partial<AppSettings>): Promise<AppSettings> {
    const input = updateSettingsInputSchema.parse(rawInput)
    return this.database.updateSettings(input)
  }
}
