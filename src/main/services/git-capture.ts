import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'

import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git'

import {
  createGitSnapshot,
  gitSnapshotSchema,
  isSecretPath,
  redactSecrets,
  type GitSnapshot,
  type RawDiffStat,
  type RawGitStatus,
  type RecentCommit
} from '../../shared'

const EMPTY_COMMIT = '0000000000000000000000000000000000000000'
const MAX_CAPTURE_FILES = 20_000
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024
const MAX_INDEX_METADATA_BYTES = 128 * 1024 * 1024
const MAX_SHALLOW_METADATA_BYTES = 4 * 1024 * 1024
const MAX_SHARED_INDEX_FILES = 64
const CHECK_IGNORE_BATCH_SIZE = 250
const SAFE_GIT_CONFIG = [
  'core.fsmonitor=false',
  'core.quotePath=false',
  'core.untrackedCache=false',
  'status.showUntrackedFiles=all',
  'status.submoduleSummary=false',
  'submodule.recurse=false',
  'log.showSignature=false',
  'credential.helper=',
  'core.askPass=',
  'core.pager='
] as const

export class InvalidRepositoryError extends Error {
  readonly code = 'INVALID_REPOSITORY'

  constructor(message = 'The selected folder is not a Git repository.', cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'InvalidRepositoryError'
  }
}

export class CaptureLimitError extends Error {
  readonly code = 'CAPTURE_LIMIT_EXCEEDED'

  constructor() {
    super('This repository has too many changed files to capture safely.')
    this.name = 'CaptureLimitError'
  }
}

export interface ResolvedRepository {
  readonly path: string
  readonly name: string
}

export interface CaptureOptions {
  readonly exclusionPatterns?: readonly string[]
  readonly recentCommitLimit?: number
}

function normalizedPath(path: string): string {
  return path
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/')
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })
}

function gitEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of [
    'PATH',
    'Path',
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'TEMP',
    'TMP',
    'TMPDIR',
    'HOME',
    'USERPROFILE',
    'LANG',
    'LC_ALL'
  ]) {
    const value = process.env[key]
    if (value !== undefined) environment[key] = value
  }
  return {
    ...environment,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '0',
    GIT_ATTR_NOSYSTEM: '1',
    NO_COLOR: '1',
    ...overrides
  }
}

function gitFor(path: string, environment: NodeJS.ProcessEnv = {}): SimpleGit {
  const outputAbortController = new AbortController()
  const processState: GitProcessState = { outputLimitExceeded: false }
  const git = simpleGit({
    baseDir: path,
    maxConcurrentProcesses: 1,
    trimmed: true,
    config: [...SAFE_GIT_CONFIG],
    abort: AbortSignal.any([AbortSignal.timeout(30_000), outputAbortController.signal]),
    timeout: { block: 15_000, stdOut: false, stdErr: false },
    unsafe: {
      allowUnsafeAskPass: true,
      allowUnsafeConfigEnvCount: true,
      allowUnsafeCredentialHelper: true,
      allowUnsafeFsMonitor: true,
      allowUnsafePager: true
    }
  }).env(gitEnvironment(environment))
  gitProcessStates.set(git, processState)
  git.outputHandler((_command, stdout, stderr) => {
    let receivedBytes = 0
    const count = (chunk: Buffer | string): void => {
      receivedBytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength
      if (receivedBytes > MAX_GIT_OUTPUT_BYTES && !processState.outputLimitExceeded) {
        processState.outputLimitExceeded = true
        outputAbortController.abort(new CaptureLimitError())
        if (stdout instanceof Readable) stdout.destroy()
        if (stderr instanceof Readable) stderr.destroy()
      }
    }
    stdout.on('data', count)
    stderr.on('data', count)
  })
  return git
}

function secretPath(
  path: string,
  ignoredPaths: ReadonlySet<string>,
  exclusionPatterns: readonly string[]
): boolean {
  const normalized = normalizedPath(path)
  return isSecretPath(normalized, {
    gitIgnored: ignoredPaths.has(normalized),
    exclusionPatterns
  })
}

function toRawStatus(
  status: StatusResult,
  ignoredPaths: ReadonlySet<string>,
  exclusionPatterns: readonly string[],
  branch: BranchState
): RawGitStatus {
  const renames = status.renamed
    .filter(
      ({ from, to }) =>
        !secretPath(from, ignoredPaths, exclusionPatterns) &&
        !secretPath(to, ignoredPaths, exclusionPatterns)
    )
    .map(({ from, to }) => ({ from, to }))

  // simple-git can expose a rename row with a NUL-delimited `to/from` path.
  // Rebuild those rows from its canonical rename collection after both
  // endpoints have passed the privacy checks above.
  const filesByPath = new Map(
    status.files
      .filter(
        (file) =>
          file.index !== 'R' &&
          file.working_dir !== 'R' &&
          !containsControlCharacter(file.path) &&
          !secretPath(file.path, ignoredPaths, exclusionPatterns)
      )
      .map((file) => [
        file.path,
        {
          path: file.path,
          index: file.index,
          workingDir: file.working_dir
        }
      ])
  )
  const modifiedPaths = new Set(status.modified)
  for (const rename of renames) {
    if (filesByPath.has(rename.to)) continue
    filesByPath.set(rename.to, {
      path: rename.to,
      index: 'R',
      workingDir: modifiedPaths.has(rename.to) ? 'M' : ' '
    })
  }

  return {
    current: branch.current,
    detached: branch.detached,
    files: [...filesByPath.values()],
    renamed: renames
  }
}

interface BranchState {
  readonly current: string | null
  readonly detached: boolean
}

interface SafeGitView {
  readonly git: SimpleGit
  cleanup(): Promise<void>
}

interface GitProcessState {
  outputLimitExceeded: boolean
}

const gitProcessStates = new WeakMap<SimpleGit, GitProcessState>()

function assertGitOutputWithinLimit(git: SimpleGit): void {
  if (gitProcessStates.get(git)?.outputLimitExceeded) throw new CaptureLimitError()
}

async function runGit<T>(git: SimpleGit, operation: () => Promise<T>): Promise<T> {
  try {
    const value = await operation()
    assertGitOutputWithinLimit(git)
    return value
  } catch (error: unknown) {
    assertGitOutputWithinLimit(git)
    throw error
  }
}

interface SafeCoreConfigSpec {
  readonly key: string
  readonly values: ReadonlySet<string>
}

const SAFE_CORE_CONFIG_SPECS: readonly SafeCoreConfigSpec[] = [
  { key: 'autocrlf', values: new Set(['true', 'false', 'input']) },
  { key: 'eol', values: new Set(['native', 'lf', 'crlf']) },
  { key: 'filemode', values: new Set(['true', 'false']) },
  { key: 'ignorecase', values: new Set(['true', 'false']) },
  { key: 'symlinks', values: new Set(['true', 'false']) },
  { key: 'checkstat', values: new Set(['default', 'minimal']) },
  { key: 'trustctime', values: new Set(['true', 'false']) },
  { key: 'precomposeunicode', values: new Set(['true', 'false']) }
]

async function readSafeCoreConfig(git: SimpleGit): Promise<readonly string[]> {
  const settings: string[] = []
  for (const spec of SAFE_CORE_CONFIG_SPECS) {
    try {
      const value = (await runGit(git, () => git.raw(['config', '--get', `core.${spec.key}`])))
        .trim()
        .toLowerCase()
      if (spec.values.has(value)) settings.push(`\t${spec.key} = ${value}\n`)
    } catch (error: unknown) {
      if (error instanceof CaptureLimitError) throw error
      // Unset inert options use Git's built-in default in the isolated view.
    }
  }
  return settings
}

function resolveGitPath(repositoryPath: string, gitPath: string): string {
  const trimmed = gitPath.trim()
  if (trimmed.length === 0) throw new InvalidRepositoryError('Git returned an empty metadata path.')
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(repositoryPath, trimmed)
}

function missingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

async function copyRegularFileIfPresent(
  source: string,
  destination: string,
  maximumBytes: number
): Promise<number | null> {
  let metadata
  try {
    metadata = await lstat(source)
  } catch (error: unknown) {
    if (missingFile(error)) return null
    throw error
  }
  if (!metadata.isFile()) {
    throw new InvalidRepositoryError('Git metadata must be stored in regular files.')
  }
  if (metadata.size > maximumBytes) throw new CaptureLimitError()
  await copyFile(source, destination)
  await chmod(destination, 0o600)
  return metadata.size
}

async function copyIndexMetadata(indexPath: string, isolatedGitDirectory: string): Promise<void> {
  const copiedBytes = await copyRegularFileIfPresent(
    indexPath,
    join(isolatedGitDirectory, 'index'),
    MAX_INDEX_METADATA_BYTES
  )
  if (copiedBytes === null) return

  const sharedIndexes = (await readdir(dirname(indexPath), { withFileTypes: true })).filter(
    ({ name }) => /^sharedindex\.[0-9a-f]{40,64}$/i.test(name)
  )
  if (sharedIndexes.length > MAX_SHARED_INDEX_FILES) throw new CaptureLimitError()

  let totalBytes = copiedBytes
  for (const entry of sharedIndexes) {
    if (!entry.isFile()) {
      throw new InvalidRepositoryError('A shared Git index is not a regular file.')
    }
    const source = join(dirname(indexPath), entry.name)
    const remainingBytes = MAX_INDEX_METADATA_BYTES - totalBytes
    if (remainingBytes <= 0) throw new CaptureLimitError()
    const bytes = await copyRegularFileIfPresent(
      source,
      join(isolatedGitDirectory, entry.name),
      remainingBytes
    )
    if (bytes !== null) totalBytes += bytes
  }
}

async function assertNoObjectAlternates(objectDirectory: string): Promise<void> {
  try {
    await lstat(join(objectDirectory, 'info', 'alternates'))
  } catch (error: unknown) {
    if (missingFile(error)) return
    throw error
  }
  throw new InvalidRepositoryError(
    'Repositories using an alternate Git object database cannot be captured safely.'
  )
}

async function readBranchState(git: SimpleGit): Promise<BranchState> {
  try {
    const current = (
      await runGit(git, () => git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD']))
    ).trim()
    return current.length > 0 ? { current, detached: false } : { current: null, detached: true }
  } catch (error: unknown) {
    if (error instanceof CaptureLimitError) throw error
    return { current: null, detached: true }
  }
}

/**
 * Builds a config-isolated Git metadata view for commands that inspect the worktree.
 *
 * Git status and diff may otherwise execute repository-configured clean/process filters
 * selected by .gitattributes. This view deliberately has no repository, global, or
 * system configuration and no info/attributes file. It reuses only the original object
 * database and index, with optional index writes disabled by the common Git environment.
 */
async function createSafeGitView(
  repositoryPath: string,
  discoveryGit: SimpleGit,
  commitHash: string
): Promise<SafeGitView> {
  const indexPath = resolveGitPath(
    repositoryPath,
    await runGit(discoveryGit, () => discoveryGit.revparse(['--git-path', 'index']))
  )
  const objectDirectory = resolveGitPath(
    repositoryPath,
    await runGit(discoveryGit, () => discoveryGit.revparse(['--git-path', 'objects']))
  )
  const shallowPath = resolveGitPath(
    repositoryPath,
    await runGit(discoveryGit, () => discoveryGit.revparse(['--git-path', 'shallow']))
  )
  if (!(await stat(objectDirectory)).isDirectory()) {
    throw new InvalidRepositoryError('The Git object database is unavailable.')
  }
  await assertNoObjectAlternates(objectDirectory)

  let objectFormat = 'sha1'
  try {
    objectFormat = (
      await runGit(discoveryGit, () => discoveryGit.revparse(['--show-object-format=storage']))
    ).trim()
  } catch (error: unknown) {
    if (error instanceof CaptureLimitError) throw error
    // --show-object-format was introduced after SHA-1 repositories; older Git is SHA-1-only.
  }
  if (objectFormat !== 'sha1' && objectFormat !== 'sha256') {
    throw new InvalidRepositoryError('This repository uses an unsupported Git object format.')
  }
  const safeCoreConfig = await readSafeCoreConfig(discoveryGit)

  const isolatedGitDirectory = await mkdtemp(join(tmpdir(), 'savepoint-git-view-'))
  try {
    await chmod(isolatedGitDirectory, 0o700)
    await mkdir(join(isolatedGitDirectory, 'info'), { mode: 0o700 })
    await mkdir(join(isolatedGitDirectory, 'objects', 'info'), {
      recursive: true,
      mode: 0o700
    })
    await mkdir(join(isolatedGitDirectory, 'refs', 'heads'), {
      recursive: true,
      mode: 0o700
    })
    await copyIndexMetadata(indexPath, isolatedGitDirectory)
    await copyRegularFileIfPresent(
      shallowPath,
      join(isolatedGitDirectory, 'shallow'),
      MAX_SHALLOW_METADATA_BYTES
    )
    await writeFile(
      join(isolatedGitDirectory, 'HEAD'),
      commitHash === EMPTY_COMMIT ? 'ref: refs/heads/savepoint-unborn\n' : `${commitHash}\n`,
      { encoding: 'utf8', mode: 0o600 }
    )
    const repositoryFormatVersion = objectFormat === 'sha256' ? 1 : 0
    const extension = objectFormat === 'sha256' ? '[extensions]\n\tobjectFormat = sha256\n' : ''
    await writeFile(
      join(isolatedGitDirectory, 'config'),
      `[core]\n\trepositoryFormatVersion = ${repositoryFormatVersion}\n\tbare = false\n${safeCoreConfig.join('')}${extension}`,
      { encoding: 'utf8', mode: 0o600 }
    )

    const git = gitFor(repositoryPath, {
      GIT_DIR: isolatedGitDirectory,
      GIT_WORK_TREE: repositoryPath,
      GIT_INDEX_FILE: join(isolatedGitDirectory, 'index'),
      GIT_OBJECT_DIRECTORY: objectDirectory,
      GIT_CONFIG_NOSYSTEM: '1',
      HOME: isolatedGitDirectory,
      USERPROFILE: isolatedGitDirectory,
      XDG_CONFIG_HOME: isolatedGitDirectory
    })
    return {
      git,
      cleanup: () =>
        rm(isolatedGitDirectory, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 })
    }
  } catch (error: unknown) {
    await rm(isolatedGitDirectory, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 })
    throw error
  }
}

async function readCommitHash(git: SimpleGit): Promise<string> {
  try {
    const hash = (await runGit(git, () => git.revparse(['HEAD']))).trim()
    return /^[0-9a-f]{40,64}$/i.test(hash) ? hash : EMPTY_COMMIT
  } catch (error: unknown) {
    if (error instanceof CaptureLimitError) throw error
    // A freshly initialized repository has no HEAD commit yet.
    return EMPTY_COMMIT
  }
}

async function readDiffStats(git: SimpleGit): Promise<RawDiffStat[]> {
  try {
    const summary = await runGit(git, () =>
      git.diffSummary(['--no-ext-diff', '--no-textconv', '--ignore-submodules=all', 'HEAD', '--'])
    )
    if (summary.files.length > MAX_CAPTURE_FILES) {
      throw new CaptureLimitError()
    }
    return summary.files.map((file) => ({
      path: file.file,
      insertions: 'insertions' in file ? file.insertions : null,
      deletions: 'deletions' in file ? file.deletions : null
    }))
  } catch (error: unknown) {
    if (error instanceof CaptureLimitError) throw error
    try {
      const summary = await runGit(git, () =>
        git.diffSummary(['--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '--'])
      )
      if (summary.files.length > MAX_CAPTURE_FILES) {
        throw new CaptureLimitError()
      }
      return summary.files.map((file) => ({
        path: file.file,
        insertions: 'insertions' in file ? file.insertions : null,
        deletions: 'deletions' in file ? file.deletions : null
      }))
    } catch (fallbackError: unknown) {
      if (fallbackError instanceof CaptureLimitError) throw fallbackError
      return []
    }
  }
}

async function readRecentCommits(git: SimpleGit, limit: number): Promise<RecentCommit[]> {
  try {
    const log = await runGit(git, () =>
      git.log({
        maxCount: Math.max(0, Math.min(limit, 20)),
        strictDate: true,
        mailMap: false
      })
    )
    return log.all.map((commit) => ({
      hash: commit.hash,
      shortHash: commit.hash.slice(0, 7),
      subject: redactSecrets(commit.message.trim().slice(0, 500)),
      authorName: redactSecrets(commit.author_name.trim().slice(0, 200)),
      authoredAt: new Date(commit.date).toISOString()
    }))
  } catch (error: unknown) {
    if (error instanceof CaptureLimitError) throw error
    return []
  }
}

async function readIgnoredPaths(
  git: SimpleGit,
  candidates: readonly string[]
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set()
  const result = new Set<string>()
  const safeCandidates: string[] = []
  for (const path of candidates) {
    // Git's line-oriented check-ignore output cannot represent these names
    // unambiguously. Omit them instead of risking a privacy false negative.
    if (containsControlCharacter(path)) result.add(normalizedPath(path))
    else safeCandidates.push(path)
  }
  for (let index = 0; index < safeCandidates.length; index += CHECK_IGNORE_BATCH_SIZE) {
    const batch = safeCandidates.slice(index, index + CHECK_IGNORE_BATCH_SIZE)
    try {
      const ignored = await runGit(git, () => git.checkIgnore(['--no-index', '--', ...batch]))
      for (const path of ignored) result.add(normalizedPath(path))
    } catch (error: unknown) {
      if (error instanceof CaptureLimitError) throw error
      // Fail closed for privacy: do not persist paths whose Git ignore state is unknown.
      for (const path of batch) result.add(normalizedPath(path))
    }
  }
  return result
}

/** Captures metadata only. It never asks Git for a patch or reads source files. */
export class GitCaptureService {
  private operationQueue: Promise<void> = Promise.resolve()
  private readonly capturesInFlight = new Map<string, Promise<GitSnapshot>>()

  resolveRepository(selectedPath: string): Promise<ResolvedRepository> {
    return this.enqueue(() => this.resolveRepositoryNow(selectedPath))
  }

  capture(repositoryPath: string, options: CaptureOptions = {}): Promise<GitSnapshot> {
    const key = `${resolve(repositoryPath)}\0${JSON.stringify(options.exclusionPatterns ?? [])}`
    const existing = this.capturesInFlight.get(key)
    if (existing) return existing
    const capture = this.enqueue(() => this.captureNow(repositoryPath, options))
    this.capturesInFlight.set(key, capture)
    void capture
      .finally(() => {
        if (this.capturesInFlight.get(key) === capture) this.capturesInFlight.delete(key)
      })
      .catch(() => undefined)
    return capture
  }

  private async resolveRepositoryNow(selectedPath: string): Promise<ResolvedRepository> {
    const requested = resolve(selectedPath)
    try {
      if (!(await stat(requested)).isDirectory()) throw new InvalidRepositoryError()
      const git = gitFor(requested)
      if (!(await runGit(git, () => git.checkIsRepo()))) throw new InvalidRepositoryError()
      if ((await runGit(git, () => git.revparse(['--is-bare-repository']))).trim() !== 'false') {
        throw new InvalidRepositoryError('Bare Git repositories cannot be captured.')
      }
      const root = resolve((await runGit(git, () => git.revparse(['--show-toplevel']))).trim())
      const canonicalPath = await realpath(root)
      return { path: canonicalPath, name: basename(canonicalPath) }
    } catch (error: unknown) {
      if (error instanceof InvalidRepositoryError) throw error
      if (error instanceof CaptureLimitError) throw error
      throw new InvalidRepositoryError(undefined, error)
    }
  }

  private async captureNow(repositoryPath: string, options: CaptureOptions): Promise<GitSnapshot> {
    const repository = await this.resolveRepositoryNow(repositoryPath)
    const discoveryGit = gitFor(repository.path)
    const [commitHash, branch] = await Promise.all([
      readCommitHash(discoveryGit),
      readBranchState(discoveryGit)
    ])
    const safeView = await createSafeGitView(repository.path, discoveryGit, commitHash)
    try {
      const status = await runGit(safeView.git, () =>
        safeView.git.status(['--ignore-submodules=all'])
      )
      if (status.files.length > MAX_CAPTURE_FILES) throw new CaptureLimitError()
      const candidatePaths = [
        ...status.files.map((file) => file.path),
        ...status.renamed.flatMap(({ from, to }) => [from, to])
      ]
      const ignoredPaths = await readIgnoredPaths(discoveryGit, candidatePaths)
      const exclusionPatterns = options.exclusionPatterns ?? []
      const rawStatus = toRawStatus(status, ignoredPaths, exclusionPatterns, branch)
      const diffStats = (await readDiffStats(safeView.git)).filter(
        (entry) => !secretPath(entry.path, ignoredPaths, exclusionPatterns)
      )
      const recentCommits = await readRecentCommits(safeView.git, options.recentCommitLimit ?? 5)

      return gitSnapshotSchema.parse(
        createGitSnapshot({
          status: rawStatus,
          commitHash,
          shortCommitHash: commitHash.slice(0, 7),
          diffStats,
          recentCommits
        })
      )
    } finally {
      await safeView.cleanup()
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.operationQueue.then(operation)
    this.operationQueue = queued.then(
      () => undefined,
      () => undefined
    )
    return queued
  }
}
