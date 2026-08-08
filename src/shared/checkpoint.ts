import {
  checkpointSchema,
  gitSnapshotSchema,
  type Checkpoint,
  type CreateCheckpointInput,
  type GitSnapshot
} from './schemas'
import { sanitizeCheckpointContext, sanitizeGitSnapshot, type SecretPathOptions } from './security'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, entryValue]) => [key, canonicalize(entryValue)])
    )
  }
  return value
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

/** A deterministic 64-hex content fingerprint for deduplication, not authentication. */
export function fingerprintValue(value: unknown): string {
  const input = stableStringify(value)
  const seeds = [
    0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5
  ]
  return seeds
    .map((seed, seedIndex) => {
      let hash = seed >>> 0
      for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index) + seedIndex
        hash = Math.imul(hash, 0x01000193)
        hash ^= hash >>> 13
      }
      return (hash >>> 0).toString(16).padStart(8, '0')
    })
    .join('')
}

function meaningfulGitState(snapshot: GitSnapshot): unknown {
  return {
    branch: snapshot.branch,
    commitHash: snapshot.commitHash,
    isClean: snapshot.isClean,
    files: [...snapshot.files]
      .map((file) => ({
        path: file.path,
        previousPath: file.previousPath,
        status: file.status,
        staged: file.staged,
        additions: file.additions,
        deletions: file.deletions
      }))
      .sort((left, right) => left.path.localeCompare(right.path, 'en')),
    diffStats: snapshot.diffStats
  }
}

export function createCheckpointFingerprint(
  value: GitSnapshot | Pick<Checkpoint, 'git'>,
  options: SecretPathOptions = {}
): string {
  const snapshot = 'git' in value ? value.git : value
  return fingerprintValue(
    meaningfulGitState(sanitizeGitSnapshot(gitSnapshotSchema.parse(snapshot), options))
  )
}

export function isDuplicateCheckpointState(
  left: GitSnapshot | Pick<Checkpoint, 'git' | 'fingerprint'>,
  right: GitSnapshot | Pick<Checkpoint, 'git' | 'fingerprint'>
): boolean {
  const leftFingerprint =
    'fingerprint' in left ? left.fingerprint : createCheckpointFingerprint(left)
  const rightFingerprint =
    'fingerprint' in right ? right.fingerprint : createCheckpointFingerprint(right)
  return leftFingerprint === rightFingerprint
}

export interface BuildCheckpointOptions extends SecretPathOptions {
  id: string
  createdAt?: string | Date
  ignoredPaths?: ReadonlySet<string>
}

/** Builds the persistable record only after secret filtering and strict validation. */
export function buildCheckpoint(
  input: CreateCheckpointInput,
  options: BuildCheckpointOptions
): Checkpoint {
  const parsed = {
    ...input,
    context: sanitizeCheckpointContext(input.context),
    git: sanitizeGitSnapshot(input.git, options)
  }
  return checkpointSchema.parse({
    ...parsed,
    id: options.id,
    createdAt:
      options.createdAt instanceof Date
        ? options.createdAt.toISOString()
        : (options.createdAt ?? new Date().toISOString()),
    fingerprint: createCheckpointFingerprint(parsed.git, options)
  })
}
