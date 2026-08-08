import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, basename } from 'node:path'

import initSqlJs, {
  type BindParams,
  type Database as SqlDatabase,
  type ParamsObject,
  type SqlValue
} from 'sql.js'

import {
  appSettingsSchema,
  buildCheckpoint,
  checkpointSchema,
  createCheckpointFingerprint,
  createCheckpointInputSchema,
  listCheckpointsInputSchema,
  repositorySchema,
  sanitizeCheckpointContext,
  updateCheckpointInputSchema,
  updateSettingsInputSchema,
  type AppSettings,
  type Checkpoint,
  type CheckpointContext,
  type CreateCheckpointInput,
  type GitSnapshot,
  type ListCheckpointsInput,
  type Repository,
  type UpdateCheckpointInput
} from '../../../shared'
import { latestSchemaVersion, migrations } from './migrations'

const require = createRequire(import.meta.url)

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  defaultAutoCheckpointIntervalMinutes: 10,
  onboardingComplete: false
}

export interface DatabaseOptions {
  /** Omit for an in-memory database. */
  readonly filePath?: string
  /** Primarily useful in tests and packaged builds. */
  readonly wasmPath?: string
  readonly now?: () => Date
  readonly idFactory?: () => string
}

export interface RepositoryUpdate {
  readonly id: string
  readonly autoCheckpointEnabled?: boolean
  readonly autoCheckpointIntervalMinutes?: number
  readonly exclusionPatterns?: readonly string[]
}

export interface MigrationRecord {
  readonly version: number
  readonly name: string
  readonly appliedAt: string
}

type CheckpointFilter = Partial<ListCheckpointsInput>

function asString(value: SqlValue | undefined, column: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Database column ${column} is not text`)
  }
  return value
}

function asNumber(value: SqlValue | undefined, column: string): number {
  if (typeof value !== 'number') {
    throw new Error(`Database column ${column} is not numeric`)
  }
  return value
}

function asNullableString(value: SqlValue | undefined, column: string): string | null {
  if (value === null) return null
  return asString(value, column)
}

function parseJson<T>(text: string): T {
  const value: unknown = JSON.parse(text)
  return value as T
}

function uniqueTrimmed(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    const key = trimmed.toLocaleLowerCase()
    if (trimmed && !seen.has(key)) {
      seen.add(key)
      result.push(trimmed)
    }
  }
  return result
}

/** Stable fingerprint of only repository state, never user-authored context. */
export function fingerprintGitSnapshot(snapshot: GitSnapshot): string {
  return createCheckpointFingerprint(snapshot)
}

function resolveDefaultWasmPath(): string {
  return require.resolve('sql.js/dist/sql-wasm.wasm')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporaryPath, 'wx', 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

/**
 * sql.js-backed relational store. The database stays in memory while open and
 * is exported to disk after every committed mutation. Writes are serialized
 * and atomically renamed so a terminated process cannot leave a partial file.
 */
export class SavePointDatabase {
  readonly filePath: string | undefined

  private readonly database: SqlDatabase
  private readonly now: () => Date
  private readonly idFactory: () => string
  private persistenceQueue: Promise<void> = Promise.resolve()
  private closed = false

  private constructor(database: SqlDatabase, options: DatabaseOptions) {
    this.database = database
    this.filePath = options.filePath
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? randomUUID
  }

  static async open(options: DatabaseOptions = {}): Promise<SavePointDatabase> {
    const wasmPath = options.wasmPath ?? resolveDefaultWasmPath()
    const SQL = await initSqlJs({ locateFile: () => wasmPath })
    const data =
      options.filePath && (await fileExists(options.filePath))
        ? new Uint8Array(await readFile(options.filePath))
        : undefined
    const store = new SavePointDatabase(new SQL.Database(data), options)
    store.database.run('PRAGMA foreign_keys = ON;')
    await store.migrate()
    return store
  }

  get schemaVersion(): number {
    const row = this.queryOne('PRAGMA user_version;')
    return row ? asNumber(row.user_version, 'user_version') : 0
  }

  listMigrations(): MigrationRecord[] {
    return this.queryAll(
      'SELECT version, name, applied_at FROM migrations ORDER BY version ASC'
    ).map((row) => ({
      version: asNumber(row.version, 'version'),
      name: asString(row.name, 'name'),
      appliedAt: asString(row.applied_at, 'applied_at')
    }))
  }

  async close(): Promise<void> {
    if (this.closed) return
    await this.persistenceQueue
    if (this.filePath) await this.persistSnapshot(this.exportSnapshot())
    this.database.close()
    this.closed = true
  }

  listRepositories(): Repository[] {
    this.assertOpen()
    return this.queryAll('SELECT * FROM repositories ORDER BY name COLLATE NOCASE, path').map(
      (row) => this.mapRepository(row)
    )
  }

  getRepository(id: string): Repository | null {
    this.assertOpen()
    const row = this.queryOne('SELECT * FROM repositories WHERE id = ?', [id])
    return row ? this.mapRepository(row) : null
  }

  findRepositoryByPath(path: string): Repository | null {
    this.assertOpen()
    const row = this.queryOne('SELECT * FROM repositories WHERE path = ?', [path])
    return row ? this.mapRepository(row) : null
  }

  async registerRepository(path: string, name = basename(path)): Promise<Repository> {
    this.assertOpen()
    const existing = this.findRepositoryByPath(path)
    if (existing) return existing

    const timestamp = this.now().toISOString()
    const repository = repositorySchema.parse({
      id: this.idFactory(),
      name,
      path,
      createdAt: timestamp,
      updatedAt: timestamp,
      autoCheckpointEnabled: false,
      autoCheckpointIntervalMinutes: 10,
      exclusionPatterns: []
    })
    this.database.run(
      `INSERT INTO repositories (
        id, name, path, created_at, updated_at, auto_checkpoint_enabled,
        auto_checkpoint_interval_minutes, exclusion_patterns_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        repository.id,
        repository.name,
        repository.path,
        repository.createdAt,
        repository.updatedAt,
        0,
        repository.autoCheckpointIntervalMinutes,
        JSON.stringify(repository.exclusionPatterns)
      ]
    )
    await this.persist()
    return repository
  }

  async updateRepository(update: RepositoryUpdate): Promise<Repository> {
    this.assertOpen()
    const current = this.getRepository(update.id)
    if (!current) throw new Error('Repository not found')

    const repository = repositorySchema.parse({
      ...current,
      updatedAt: this.now().toISOString(),
      ...(update.autoCheckpointEnabled === undefined
        ? {}
        : { autoCheckpointEnabled: update.autoCheckpointEnabled }),
      ...(update.autoCheckpointIntervalMinutes === undefined
        ? {}
        : { autoCheckpointIntervalMinutes: update.autoCheckpointIntervalMinutes }),
      ...(update.exclusionPatterns === undefined
        ? {}
        : { exclusionPatterns: uniqueTrimmed(update.exclusionPatterns) })
    })

    this.database.run(
      `UPDATE repositories SET
        updated_at = ?, auto_checkpoint_enabled = ?,
        auto_checkpoint_interval_minutes = ?, exclusion_patterns_json = ?
       WHERE id = ?`,
      [
        repository.updatedAt,
        repository.autoCheckpointEnabled ? 1 : 0,
        repository.autoCheckpointIntervalMinutes,
        JSON.stringify(repository.exclusionPatterns),
        repository.id
      ]
    )
    await this.persist()
    return repository
  }

  async removeRepository(id: string): Promise<boolean> {
    this.assertOpen()
    this.database.run('DELETE FROM repositories WHERE id = ?', [id])
    const deleted = this.database.getRowsModified() > 0
    if (deleted) {
      this.removeUnusedTags()
      await this.persist()
    }
    return deleted
  }

  async createCheckpoint(rawInput: CreateCheckpointInput): Promise<Checkpoint> {
    this.assertOpen()
    const input = createCheckpointInputSchema.parse(rawInput)
    if (!this.getRepository(input.repositoryId)) throw new Error('Repository not found')

    const checkpoint = buildCheckpoint(
      {
        ...input,
        context: {
          ...input.context,
          tags: uniqueTrimmed(input.context.tags),
          links: [...new Set(input.context.links)],
          commands: [...input.context.commands]
        }
      },
      { id: this.idFactory(), createdAt: this.now() }
    )

    this.transaction(() => {
      const { context, git } = checkpoint
      this.database.run(
        `INSERT INTO checkpoints (
          id, repository_id, created_at, origin, title, goal, completed,
          next_action, blockers, notes, branch, commit_hash, short_commit_hash,
          is_clean, count_staged, count_modified, count_added, count_deleted,
          count_renamed, count_copied, count_untracked, count_conflicted,
          diff_files_changed, diff_insertions, diff_deletions,
          recent_commits_json, fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          checkpoint.id,
          checkpoint.repositoryId,
          checkpoint.createdAt,
          checkpoint.origin,
          context.title,
          context.goal,
          context.completed,
          context.nextAction,
          context.blockers,
          context.notes,
          git.branch,
          git.commitHash,
          git.shortCommitHash,
          git.isClean ? 1 : 0,
          git.counts.staged,
          git.counts.modified,
          git.counts.added,
          git.counts.deleted,
          git.counts.renamed,
          git.counts.copied,
          git.counts.untracked,
          git.counts.conflicted,
          git.diffStats.filesChanged,
          git.diffStats.insertions,
          git.diffStats.deletions,
          JSON.stringify(git.recentCommits),
          checkpoint.fingerprint
        ]
      )
      this.replaceCheckpointRelations(checkpoint.id, checkpoint.context, checkpoint.git)
    })
    await this.persist()
    return checkpoint
  }

  getCheckpoint(id: string): Checkpoint | null {
    this.assertOpen()
    const row = this.queryOne('SELECT * FROM checkpoints WHERE id = ?', [id])
    return row ? this.mapCheckpoint(row) : null
  }

  listCheckpoints(rawFilter: CheckpointFilter = {}): Checkpoint[] {
    this.assertOpen()
    const filter = listCheckpointsInputSchema.parse(rawFilter)
    const where: string[] = []
    const parameters: SqlValue[] = []

    if (filter.repositoryId) {
      where.push('c.repository_id = ?')
      parameters.push(filter.repositoryId)
    }
    if (filter.branch) {
      where.push('c.branch = ?')
      parameters.push(filter.branch)
    }
    if (filter.origin) {
      where.push('c.origin = ?')
      parameters.push(filter.origin)
    }
    if (filter.tag) {
      where.push(`EXISTS (
        SELECT 1 FROM checkpoint_tags ct
        JOIN tags t ON t.id = ct.tag_id
        WHERE ct.checkpoint_id = c.id AND t.name = ? COLLATE NOCASE
      )`)
      parameters.push(filter.tag)
    }
    if (filter.search) {
      const escaped = filter.search
        .replaceAll('\\', '\\\\')
        .replaceAll('%', '\\%')
        .replaceAll('_', '\\_')
      const pattern = `%${escaped}%`
      where.push(`(
        c.title LIKE ? ESCAPE '\\' OR c.goal LIKE ? ESCAPE '\\' OR
        c.completed LIKE ? ESCAPE '\\' OR c.next_action LIKE ? ESCAPE '\\' OR
        c.blockers LIKE ? ESCAPE '\\' OR c.notes LIKE ? ESCAPE '\\' OR
        c.branch LIKE ? ESCAPE '\\' OR EXISTS (
          SELECT 1 FROM checkpoint_tags ct
          JOIN tags t ON t.id = ct.tag_id
          WHERE ct.checkpoint_id = c.id AND t.name LIKE ? ESCAPE '\\'
        )
      )`)
      parameters.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern)
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    parameters.push(filter.limit, filter.offset)
    return this.queryAll(
      `SELECT c.* FROM checkpoints c ${clause}
       ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`,
      parameters
    ).map((row) => this.mapCheckpoint(row))
  }

  async updateCheckpoint(rawInput: UpdateCheckpointInput): Promise<Checkpoint> {
    this.assertOpen()
    const input = updateCheckpointInputSchema.parse(rawInput)
    const current = this.getCheckpoint(input.id)
    if (!current) throw new Error('Checkpoint not found')
    const context = sanitizeCheckpointContext({ ...current.context, ...input.context })

    const updated = checkpointSchema.parse({ ...current, context })
    this.transaction(() => {
      this.database.run(
        `UPDATE checkpoints SET title = ?, goal = ?, completed = ?, next_action = ?,
         blockers = ?, notes = ? WHERE id = ?`,
        [
          updated.context.title,
          updated.context.goal,
          updated.context.completed,
          updated.context.nextAction,
          updated.context.blockers,
          updated.context.notes,
          updated.id
        ]
      )
      this.replaceCheckpointRelations(updated.id, updated.context, updated.git)
      this.removeUnusedTags()
    })
    await this.persist()
    return this.getCheckpoint(updated.id) ?? updated
  }

  async deleteCheckpoint(id: string): Promise<boolean> {
    this.assertOpen()
    this.database.run('DELETE FROM checkpoints WHERE id = ?', [id])
    const deleted = this.database.getRowsModified() > 0
    if (deleted) {
      this.removeUnusedTags()
      await this.persist()
    }
    return deleted
  }

  latestCheckpoint(repositoryId: string): Checkpoint | null {
    this.assertOpen()
    const row = this.queryOne(
      `SELECT * FROM checkpoints WHERE repository_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [repositoryId]
    )
    return row ? this.mapCheckpoint(row) : null
  }

  latestCheckpointWithFingerprint(repositoryId: string, fingerprint: string): Checkpoint | null {
    this.assertOpen()
    const row = this.queryOne(
      `SELECT * FROM checkpoints WHERE repository_id = ? AND fingerprint = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [repositoryId, fingerprint]
    )
    return row ? this.mapCheckpoint(row) : null
  }

  latestAutomaticCheckpoint(repositoryId: string): Checkpoint | null {
    this.assertOpen()
    const row = this.queryOne(
      `SELECT * FROM checkpoints WHERE repository_id = ? AND origin = 'automatic'
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [repositoryId]
    )
    return row ? this.mapCheckpoint(row) : null
  }

  getSettings(): AppSettings {
    this.assertOpen()
    const stored = new Map(
      this.queryAll('SELECT key, value_json FROM settings').map((row) => [
        asString(row.key, 'key'),
        parseJson<unknown>(asString(row.value_json, 'value_json'))
      ])
    )
    return appSettingsSchema.parse({
      theme: stored.get('theme') ?? DEFAULT_SETTINGS.theme,
      defaultAutoCheckpointIntervalMinutes:
        stored.get('defaultAutoCheckpointIntervalMinutes') ??
        DEFAULT_SETTINGS.defaultAutoCheckpointIntervalMinutes,
      onboardingComplete: stored.get('onboardingComplete') ?? DEFAULT_SETTINGS.onboardingComplete
    })
  }

  async updateSettings(rawUpdate: Partial<AppSettings>): Promise<AppSettings> {
    this.assertOpen()
    const update = updateSettingsInputSchema.parse(rawUpdate)
    const timestamp = this.now().toISOString()
    this.transaction(() => {
      for (const [key, value] of Object.entries(update)) {
        this.database.run(
          `INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
             updated_at = excluded.updated_at`,
          [key, JSON.stringify(value), timestamp]
        )
      }
    })
    await this.persist()
    return this.getSettings()
  }

  private async migrate(): Promise<void> {
    this.database.run(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `)
    const current = this.schemaVersion
    if (current > latestSchemaVersion) {
      throw new Error(
        `Database schema ${current} is newer than supported schema ${latestSchemaVersion}`
      )
    }

    let changed = false
    for (const migration of migrations) {
      if (migration.version <= current) continue
      this.transaction(() => {
        this.database.run(migration.sql)
        this.database.run('INSERT INTO migrations(version, name, applied_at) VALUES (?, ?, ?)', [
          migration.version,
          migration.name,
          this.now().toISOString()
        ])
        this.database.run(`PRAGMA user_version = ${migration.version};`)
      })
      changed = true
    }
    if (changed || (this.filePath && !(await fileExists(this.filePath)))) await this.persist()
  }

  private mapRepository(row: ParamsObject): Repository {
    return repositorySchema.parse({
      id: asString(row.id, 'id'),
      name: asString(row.name, 'name'),
      path: asString(row.path, 'path'),
      createdAt: asString(row.created_at, 'created_at'),
      updatedAt: asString(row.updated_at, 'updated_at'),
      autoCheckpointEnabled: asNumber(row.auto_checkpoint_enabled, 'auto_checkpoint_enabled') === 1,
      autoCheckpointIntervalMinutes: asNumber(
        row.auto_checkpoint_interval_minutes,
        'auto_checkpoint_interval_minutes'
      ),
      exclusionPatterns: parseJson<unknown>(
        asString(row.exclusion_patterns_json, 'exclusion_patterns_json')
      )
    })
  }

  private mapCheckpoint(row: ParamsObject): Checkpoint {
    const id = asString(row.id, 'id')
    const files = this.queryAll(
      `SELECT path, status, staged, previous_path, additions, deletions
       FROM checkpoint_files WHERE checkpoint_id = ? ORDER BY id`,
      [id]
    ).map((file) => ({
      path: asString(file.path, 'path'),
      status: asString(file.status, 'status'),
      staged: asNumber(file.staged, 'staged') === 1,
      previousPath: asNullableString(file.previous_path, 'previous_path'),
      additions: file.additions === null ? null : asNumber(file.additions, 'additions'),
      deletions: file.deletions === null ? null : asNumber(file.deletions, 'deletions')
    }))
    const tags = this.queryAll(
      `SELECT t.name FROM tags t JOIN checkpoint_tags ct ON ct.tag_id = t.id
       WHERE ct.checkpoint_id = ? ORDER BY t.name COLLATE NOCASE`,
      [id]
    ).map((tag) => asString(tag.name, 'name'))
    const links = this.queryAll(
      'SELECT url FROM checkpoint_links WHERE checkpoint_id = ? ORDER BY position',
      [id]
    ).map((link) => asString(link.url, 'url'))
    const commands = this.queryAll(
      'SELECT command FROM checkpoint_commands WHERE checkpoint_id = ? ORDER BY position',
      [id]
    ).map((command) => asString(command.command, 'command'))

    return checkpointSchema.parse({
      id,
      repositoryId: asString(row.repository_id, 'repository_id'),
      createdAt: asString(row.created_at, 'created_at'),
      origin: asString(row.origin, 'origin'),
      context: {
        title: asString(row.title, 'title'),
        goal: asString(row.goal, 'goal'),
        completed: asString(row.completed, 'completed'),
        nextAction: asString(row.next_action, 'next_action'),
        blockers: asString(row.blockers, 'blockers'),
        notes: asString(row.notes, 'notes'),
        tags,
        links,
        commands
      },
      git: {
        branch: asString(row.branch, 'branch'),
        commitHash: asString(row.commit_hash, 'commit_hash'),
        shortCommitHash: asString(row.short_commit_hash, 'short_commit_hash'),
        isClean: asNumber(row.is_clean, 'is_clean') === 1,
        files,
        counts: {
          staged: asNumber(row.count_staged, 'count_staged'),
          modified: asNumber(row.count_modified, 'count_modified'),
          added: asNumber(row.count_added, 'count_added'),
          deleted: asNumber(row.count_deleted, 'count_deleted'),
          renamed: asNumber(row.count_renamed, 'count_renamed'),
          copied: asNumber(row.count_copied, 'count_copied'),
          untracked: asNumber(row.count_untracked, 'count_untracked'),
          conflicted: asNumber(row.count_conflicted, 'count_conflicted')
        },
        diffStats: {
          filesChanged: asNumber(row.diff_files_changed, 'diff_files_changed'),
          insertions: asNumber(row.diff_insertions, 'diff_insertions'),
          deletions: asNumber(row.diff_deletions, 'diff_deletions')
        },
        recentCommits: parseJson<unknown>(asString(row.recent_commits_json, 'recent_commits_json'))
      },
      fingerprint: asString(row.fingerprint, 'fingerprint')
    })
  }

  private replaceCheckpointRelations(
    checkpointId: string,
    context: CheckpointContext,
    git: GitSnapshot
  ): void {
    this.database.run('DELETE FROM checkpoint_files WHERE checkpoint_id = ?', [checkpointId])
    this.database.run('DELETE FROM checkpoint_links WHERE checkpoint_id = ?', [checkpointId])
    this.database.run('DELETE FROM checkpoint_commands WHERE checkpoint_id = ?', [checkpointId])
    this.database.run('DELETE FROM checkpoint_tags WHERE checkpoint_id = ?', [checkpointId])

    const fileStatement = this.database.prepare(
      `INSERT INTO checkpoint_files (
        checkpoint_id, path, status, staged, previous_path, additions, deletions
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    try {
      for (const file of git.files) {
        fileStatement.run([
          checkpointId,
          file.path,
          file.status,
          file.staged ? 1 : 0,
          file.previousPath,
          file.additions,
          file.deletions
        ])
      }
    } finally {
      fileStatement.free()
    }

    context.links.forEach((url, index) => {
      this.database.run(
        'INSERT INTO checkpoint_links(checkpoint_id, position, url) VALUES (?, ?, ?)',
        [checkpointId, index, url]
      )
    })
    context.commands.forEach((command, index) => {
      this.database.run(
        `INSERT INTO checkpoint_commands(checkpoint_id, position, command)
         VALUES (?, ?, ?)`,
        [checkpointId, index, command]
      )
    })
    for (const tag of uniqueTrimmed(context.tags)) {
      this.database.run('INSERT OR IGNORE INTO tags(name) VALUES (?)', [tag])
      this.database.run(
        `INSERT INTO checkpoint_tags(checkpoint_id, tag_id)
         SELECT ?, id FROM tags WHERE name = ? COLLATE NOCASE`,
        [checkpointId, tag]
      )
    }
  }

  private removeUnusedTags(): void {
    this.database.run(
      'DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM checkpoint_tags WHERE tag_id = tags.id)'
    )
  }

  private queryAll(sql: string, params: BindParams = null): ParamsObject[] {
    const statement = this.database.prepare(sql)
    try {
      if (params !== null) statement.bind(params)
      const rows: ParamsObject[] = []
      while (statement.step()) rows.push(statement.getAsObject())
      return rows
    } finally {
      statement.free()
    }
  }

  private queryOne(sql: string, params: BindParams = null): ParamsObject | null {
    return this.queryAll(sql, params)[0] ?? null
  }

  private transaction(operation: () => void): void {
    this.database.run('BEGIN IMMEDIATE;')
    try {
      operation()
      this.database.run('COMMIT;')
    } catch (error: unknown) {
      this.database.run('ROLLBACK;')
      throw error
    }
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return
    const snapshot = this.exportSnapshot()
    const write = this.persistenceQueue.then(() => this.persistSnapshot(snapshot))
    this.persistenceQueue = write.catch(() => undefined)
    await write
  }

  private async persistSnapshot(snapshot: Uint8Array): Promise<void> {
    if (!this.filePath) return
    await atomicWrite(this.filePath, snapshot)
  }

  private exportSnapshot(): Uint8Array {
    const snapshot = this.database.export()
    // sql.js reopens its internal connection during export, resetting
    // connection-local pragmas such as foreign_keys.
    this.database.run('PRAGMA foreign_keys = ON;')
    return snapshot
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Database is closed')
  }
}
