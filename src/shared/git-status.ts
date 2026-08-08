import {
  gitDiffStatsSchema,
  gitFileSchema,
  gitSnapshotSchema,
  gitStatusCountsSchema,
  type GitDiffStats,
  type GitFile,
  type GitFileStatus,
  type GitSnapshot,
  type GitStatusCounts,
  type RecentCommit
} from './schemas'

export interface RawGitFileStatus {
  path: string
  index: string
  workingDir: string
}

/** The small, library-agnostic portion of simple-git's StatusResult we consume. */
export interface RawGitStatus {
  current?: string | null
  detached?: boolean
  files?: readonly RawGitFileStatus[]
  staged?: readonly string[]
  modified?: readonly string[]
  created?: readonly string[]
  deleted?: readonly string[]
  notAdded?: readonly string[]
  conflicted?: readonly string[]
  renamed?: ReadonlyArray<{ from: string; to: string }>
}

export interface RawDiffStat {
  path: string
  insertions: number | null
  deletions: number | null
}

export interface NormalizeGitStatusResult {
  branch: string
  isClean: boolean
  files: GitFile[]
  counts: GitStatusCounts
  diffStats: GitDiffStats
}

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

function normalizePath(path: string): string {
  // Git porcelain uses `/` on every platform. A backslash is a valid filename
  // character on POSIX, so changing it here would corrupt untrusted metadata.
  return path.replace(/^\.\//, '').replace(/\/{2,}/g, '/')
}

function statusFromCodes(index: string, workingDir: string): GitFileStatus {
  const pair = `${index}${workingDir}`
  if (CONFLICT_CODES.has(pair) || index === 'U' || workingDir === 'U') return 'conflicted'
  if (pair === '??') return 'untracked'
  if (pair === '!!') return 'ignored'
  if (index === 'R' || workingDir === 'R') return 'renamed'
  if (index === 'C' || workingDir === 'C') return 'copied'
  if (index === 'D' || workingDir === 'D') return 'deleted'
  if (index === 'A' || workingDir === 'A') return 'added'
  if (index === 'M' || workingDir === 'M' || index === 'T' || workingDir === 'T') return 'modified'
  return 'unknown'
}

function isStaged(index: string, status: GitFileStatus): boolean {
  return status !== 'conflicted' && index !== ' ' && index !== '?' && index !== '!' && index !== ''
}

function createFallbackFiles(status: RawGitStatus): RawGitFileStatus[] {
  const byPath = new Map<string, RawGitFileStatus>()
  const add = (paths: readonly string[] | undefined, index: string, workingDir: string): void => {
    for (const path of paths ?? []) {
      const normalized = normalizePath(path)
      if (!normalized) continue
      byPath.set(normalized, { path: normalized, index, workingDir })
    }
  }

  add(status.notAdded, '?', '?')
  add(status.modified, ' ', 'M')
  add(status.created, 'A', ' ')
  add(status.deleted, ' ', 'D')
  add(status.conflicted, 'U', 'U')
  add(status.staged, 'M', ' ')
  for (const rename of status.renamed ?? []) {
    byPath.set(normalizePath(rename.to), {
      path: normalizePath(rename.to),
      index: 'R',
      workingDir: ' '
    })
  }
  return [...byPath.values()]
}

function countFiles(files: readonly GitFile[]): GitStatusCounts {
  const counts: GitStatusCounts = {
    staged: 0,
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    untracked: 0,
    conflicted: 0
  }
  for (const file of files) {
    if (file.staged) counts.staged += 1
    if (file.status !== 'ignored' && file.status !== 'unknown') counts[file.status] += 1
  }
  return gitStatusCountsSchema.parse(counts)
}

function summarizeDiff(files: readonly GitFile[], stats: readonly RawDiffStat[]): GitDiffStats {
  const byPath = new Map(stats.map((stat) => [normalizePath(stat.path), stat]))
  let insertions = 0
  let deletions = 0
  let filesChanged = 0
  for (const file of files) {
    if (file.status === 'ignored') continue
    filesChanged += 1
    const stat = byPath.get(file.path)
    insertions += stat?.insertions ?? file.additions ?? 0
    deletions += stat?.deletions ?? file.deletions ?? 0
  }
  return gitDiffStatsSchema.parse({ filesChanged, insertions, deletions })
}

/**
 * Converts porcelain status codes into SavePoint's stable domain representation.
 * It intentionally captures metadata only; source contents and diff hunks never enter the model.
 */
export function normalizeGitStatus(
  status: RawGitStatus,
  diffStats: readonly RawDiffStat[] = []
): NormalizeGitStatusResult {
  const renameFromByTo = new Map(
    (status.renamed ?? []).map(({ from, to }) => [normalizePath(to), normalizePath(from)])
  )
  const statByPath = new Map(diffStats.map((stat) => [normalizePath(stat.path), stat]))
  const rawFiles =
    status.files && status.files.length > 0 ? status.files : createFallbackFiles(status)
  const byPath = new Map<string, GitFile>()

  for (const raw of rawFiles) {
    const path = normalizePath(raw.path)
    if (!path) continue
    const stat = statByPath.get(path)
    const normalizedStatus = statusFromCodes(raw.index, raw.workingDir)
    const file = gitFileSchema.parse({
      path,
      status: normalizedStatus,
      staged: isStaged(raw.index, normalizedStatus),
      previousPath: renameFromByTo.get(path) ?? null,
      additions: stat?.insertions ?? null,
      deletions: stat?.deletions ?? null
    })
    byPath.set(path, file)
  }

  const files = [...byPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path, 'en')
  )
  const visibleFiles = files.filter((file) => file.status !== 'ignored')
  return {
    branch: status.current?.trim() || (status.detached ? '(detached HEAD)' : '(no branch)'),
    isClean: visibleFiles.length === 0,
    files,
    counts: countFiles(files),
    diffStats: summarizeDiff(files, diffStats)
  }
}

export interface CreateGitSnapshotInput {
  status: RawGitStatus
  commitHash: string
  shortCommitHash?: string
  diffStats?: readonly RawDiffStat[]
  recentCommits?: readonly RecentCommit[]
}

export function createGitSnapshot(input: CreateGitSnapshotInput): GitSnapshot {
  const normalized = normalizeGitStatus(input.status, input.diffStats)
  return gitSnapshotSchema.parse({
    ...normalized,
    commitHash: input.commitHash,
    shortCommitHash: input.shortCommitHash ?? input.commitHash.slice(0, 7),
    recentCommits: input.recentCommits ?? []
  })
}
