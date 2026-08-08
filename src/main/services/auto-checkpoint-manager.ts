import {
  AutoCheckpointScheduler,
  DEFAULT_AUTO_CHECKPOINT_DEBOUNCE_MS,
  createCheckpointFingerprint,
  type Checkpoint,
  type CheckpointContext,
  type Repository
} from '../../shared'
import { SavePointDatabase } from './database/database'
import { GitCaptureService } from './git-capture'

const EMPTY_CONTEXT: CheckpointContext = {
  title: 'Automatic checkpoint',
  goal: '',
  completed: '',
  nextAction: '',
  blockers: '',
  notes: '',
  tags: [],
  links: [],
  commands: []
}

export interface AutoCheckpointManagerOptions {
  readonly pollIntervalMs?: number
  readonly debounceMs?: number
  readonly now?: () => Date
  readonly onCheckpoint?: (checkpoint: Checkpoint) => void
  readonly onError?: (repository: Repository, error: unknown) => void
}

/**
 * Lightweight per-repository poller. Git itself remains the source of truth;
 * no source contents are read and no filesystem event payloads are persisted.
 */
export class AutoCheckpointManager {
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>()
  private readonly inFlight = new Set<string>()
  private readonly scheduler = new AutoCheckpointScheduler()
  private readonly pollIntervalMs: number
  private readonly debounceMs: number
  private readonly now: () => Date

  constructor(
    private readonly database: SavePointDatabase,
    private readonly captureService: GitCaptureService,
    private readonly options: AutoCheckpointManagerOptions = {}
  ) {
    this.pollIntervalMs = Math.max(500, options.pollIntervalMs ?? 5_000)
    this.debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_AUTO_CHECKPOINT_DEBOUNCE_MS)
    this.now = options.now ?? (() => new Date())
  }

  sync(repositories = this.database.listRepositories()): void {
    const enabledIds = new Set(
      repositories.filter((repository) => repository.autoCheckpointEnabled).map(({ id }) => id)
    )
    for (const id of this.timers.keys()) {
      if (!enabledIds.has(id)) this.stop(id)
    }
    for (const repository of repositories) {
      if (repository.autoCheckpointEnabled) this.start(repository.id)
    }
  }

  start(repositoryId: string): void {
    if (this.timers.has(repositoryId)) return
    const repository = this.database.getRepository(repositoryId)
    if (!repository?.autoCheckpointEnabled) return

    void this.pollSafely(repositoryId)
    const timer = setInterval(() => void this.pollSafely(repositoryId), this.pollIntervalMs)
    timer.unref()
    this.timers.set(repositoryId, timer)
  }

  stop(repositoryId: string): void {
    const timer = this.timers.get(repositoryId)
    if (timer) clearInterval(timer)
    this.timers.delete(repositoryId)
    this.scheduler.reset(repositoryId)
  }

  dispose(): void {
    for (const id of [...this.timers.keys()]) this.stop(id)
  }

  /** Runs one observation cycle; exposed for deterministic integration tests. */
  async checkNow(repositoryId: string): Promise<Checkpoint | null> {
    const repository = this.database.getRepository(repositoryId)
    if (!repository?.autoCheckpointEnabled) {
      this.scheduler.reset(repositoryId)
      return null
    }

    const snapshot = await this.captureService.capture(repository.path, {
      exclusionPatterns: repository.exclusionPatterns
    })
    const currentConfiguration = this.database.getRepository(repositoryId)
    const configurationChanged =
      !currentConfiguration ||
      !currentConfiguration.autoCheckpointEnabled ||
      currentConfiguration.path !== repository.path ||
      currentConfiguration.autoCheckpointIntervalMinutes !==
        repository.autoCheckpointIntervalMinutes ||
      JSON.stringify(currentConfiguration.exclusionPatterns) !==
        JSON.stringify(repository.exclusionPatterns)
    if (configurationChanged) {
      this.scheduler.reset(repositoryId)
      return null
    }
    const fingerprint = createCheckpointFingerprint(snapshot)
    const latest = this.database.latestCheckpoint(repositoryId)
    const latestAutomatic = this.database.latestAutomaticCheckpoint(repositoryId)
    const decision = this.scheduler.evaluate(repositoryId, {
      enabled: repository.autoCheckpointEnabled,
      currentFingerprint: fingerprint,
      lastCheckpointFingerprint: latest?.fingerprint,
      lastAutomaticCheckpointAt: latestAutomatic?.createdAt,
      intervalMinutes: repository.autoCheckpointIntervalMinutes,
      debounceMs: this.debounceMs,
      now: this.now()
    })
    if (!decision.shouldCreate) return null

    const previousContext = latest?.context ?? EMPTY_CONTEXT
    const contextualTitle = previousContext.title.replace(/^Automatic:\s*/i, '')
    const checkpoint = await this.database.createCheckpoint({
      repositoryId,
      origin: 'automatic',
      context: {
        ...previousContext,
        title: contextualTitle ? `Automatic: ${contextualTitle}`.slice(0, 200) : EMPTY_CONTEXT.title
      },
      git: snapshot
    })
    this.options.onCheckpoint?.(checkpoint)
    return checkpoint
  }

  private async pollSafely(repositoryId: string): Promise<void> {
    if (this.inFlight.has(repositoryId)) return
    this.inFlight.add(repositoryId)
    try {
      await this.checkNow(repositoryId)
    } catch (error: unknown) {
      const repository = this.database.getRepository(repositoryId)
      if (repository) this.options.onError?.(repository, error)
    } finally {
      this.inFlight.delete(repositoryId)
    }
  }
}
