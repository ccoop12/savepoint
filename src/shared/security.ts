import {
  checkpointContextSchema,
  gitSnapshotSchema,
  type CheckpointContext,
  type GitFile,
  type GitSnapshot,
  type GitStatusCounts
} from './schemas'

export const REDACTION_MARKER = '[REDACTED]'

export interface SecretPathOptions {
  gitIgnored?: boolean
  exclusionPatterns?: readonly string[]
}

const SECRET_FILE_NAMES = new Set([
  '.env',
  '.envrc',
  '.git-credentials',
  '.npmrc',
  '.pgpass',
  '.pypirc',
  '.netrc',
  '.vault-token',
  '_netrc',
  'credentials',
  'credentials.json',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  'pgpass.conf',
  'service-account.json',
  'service_account.json',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519'
])
const SECRET_EXTENSIONS = new Set([
  '.key',
  '.pem',
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
  '.crt',
  '.cer',
  '.der',
  '.ovpn'
])
const SECRET_DIRECTORIES = new Set([
  '.ssh',
  '.aws',
  '.azure',
  '.direnv',
  '.gcloud',
  '.kube',
  'secrets',
  'credentials'
])

function normalizePath(path: string): string {
  return path
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.?\//, '')
    .replace(/\/{2,}/g, '/')
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

/** Supports the common gitignore-style `*`, `**`, and `?` subset used by exclusions. */
export function matchesExclusionPattern(path: string, pattern: string): boolean {
  const normalizedPath = normalizePath(path)
  let normalizedPattern = normalizePath(pattern)
  if (!normalizedPath || !normalizedPattern || normalizedPattern.startsWith('!')) return false
  const directoryOnly = normalizedPattern.endsWith('/')
  normalizedPattern = normalizedPattern.replace(/\/$/, '')
  let source = ''
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index]
    if (character === '*' && normalizedPattern[index + 1] === '*') {
      if (normalizedPattern[index + 2] === '/') {
        source += '(?:.*/)?'
        index += 1
      } else source += '.*'
      index += 1
    } else if (character === '*') {
      source += '[^/]*'
    } else if (character === '?') {
      source += '[^/]'
    } else {
      source += escapeRegex(character)
    }
  }
  const prefix = normalizedPattern.includes('/') ? '^' : '(^|/)'
  const suffix = directoryOnly ? '(/|$)' : '$'
  return new RegExp(`${prefix}${source}${suffix}`, 'i').test(normalizedPath)
}

export function isSecretPath(path: string, options: SecretPathOptions = {}): boolean {
  if (options.gitIgnored) return true
  const normalized = normalizePath(path).toLowerCase()
  if (!normalized) return true
  const segments = normalized.split('/')
  const fileName = segments.at(-1) ?? ''
  if (fileName === '.env' || fileName.startsWith('.env.')) return true
  if (normalized === '.docker/config.json' || normalized.endsWith('/.docker/config.json'))
    return true
  if (/\.tfstate(?:\.|$)/i.test(fileName)) return true
  if (SECRET_FILE_NAMES.has(fileName)) return true
  if (SECRET_DIRECTORIES.size > 0 && segments.some((segment) => SECRET_DIRECTORIES.has(segment)))
    return true
  const extensionIndex = fileName.lastIndexOf('.')
  if (extensionIndex >= 0 && SECRET_EXTENSIONS.has(fileName.slice(extensionIndex))) return true
  if (/^(?:auth|credential|secret|token)(?:s)?(?:[-_.].*)?$/i.test(fileName)) return true
  return (options.exclusionPatterns ?? []).some((pattern) =>
    matchesExclusionPattern(normalized, pattern)
  )
}

const SENSITIVE_KEY_NAME =
  '(?:[A-Za-z0-9]+[_-])*(?:api[_-]?(?:key|token)|access[_-]?(?:key|token)|auth[_-]?token|client[_-]?secret|password|passwd|pwd|secret(?:[_-]?access[_-]?key)?|private[_-]?key|authorization)(?:[_-][A-Za-z0-9]+)*'
const SENSITIVE_QUOTED_ASSIGNMENT = new RegExp(
  `\\b(${SENSITIVE_KEY_NAME})\\b(\\s*[:=]\\s*)(["'])(.*?)\\3`,
  'gi'
)
const SENSITIVE_ASSIGNMENT = new RegExp(
  `\\b(${SENSITIVE_KEY_NAME})\\b(\\s*[:=]\\s*)([^\\s,"';}]+)`,
  'gi'
)
const BEARER_TOKEN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi
const BASIC_AUTH = /\b(Basic\s+)[A-Za-z0-9+/=]{8,}/gi
const URL_CREDENTIALS = /\b(https?:\/\/)([^\s/:@]+):([^\s/@]+)@/gi
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g
const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g
const SLACK_TOKEN = /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g
const AI_PROVIDER_TOKEN =
  /\b(?:sk-(?:proj|svcacct|ant-api\d{2})-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,})\b/g
const OTHER_COMMON_TOKEN =
  /\b(?:npm_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{30,})\b/g
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g
const PRIVATE_KEY_BLOCK =
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/gi

export function redactSecrets(value: string, marker = REDACTION_MARKER): string {
  return value
    .replace(PRIVATE_KEY_BLOCK, marker)
    .replace(URL_CREDENTIALS, '$1')
    .replace(BEARER_TOKEN, `$1${marker}`)
    .replace(BASIC_AUTH, `$1${marker}`)
    .replace(
      SENSITIVE_QUOTED_ASSIGNMENT,
      (_match, key: string, separator: string, quote: string) =>
        `${key}${separator}${quote}${marker}${quote}`
    )
    .replace(
      SENSITIVE_ASSIGNMENT,
      (_match, key: string, separator: string) => `${key}${separator}${marker}`
    )
    .replace(GITHUB_TOKEN, marker)
    .replace(AWS_ACCESS_KEY, marker)
    .replace(SLACK_TOKEN, marker)
    .replace(AI_PROVIDER_TOKEN, marker)
    .replace(OTHER_COMMON_TOKEN, marker)
    .replace(JWT, marker)
}

export function containsLikelySecret(value: string): boolean {
  return redactSecrets(value) !== value
}

const SENSITIVE_KEY =
  /(?:password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key|credential|authorization)/i

/** Redacts both secret-shaped values and values stored under secret-shaped object keys. */
export function redactSensitiveValues<T>(value: T): T {
  const visit = (current: unknown, key?: string): unknown => {
    if (key && SENSITIVE_KEY.test(key)) return REDACTION_MARKER
    if (typeof current === 'string') return redactSecrets(current)
    if (Array.isArray(current)) return current.map((item) => visit(item))
    if (current && typeof current === 'object') {
      return Object.fromEntries(
        Object.entries(current).map(([entryKey, entryValue]) => [
          entryKey,
          visit(entryValue, entryKey)
        ])
      )
    }
    return current
  }
  return visit(value) as T
}

export function filterSecretFiles(
  files: readonly GitFile[],
  options: SecretPathOptions & { ignoredPaths?: ReadonlySet<string> } = {}
): GitFile[] {
  return files.filter(
    (file) =>
      file.status !== 'ignored' &&
      !isSecretPath(file.path, {
        gitIgnored: options.gitIgnored || options.ignoredPaths?.has(file.path),
        exclusionPatterns: options.exclusionPatterns
      })
  )
}

function countsFor(files: readonly GitFile[]): GitStatusCounts {
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
  return counts
}

/** Removes secret-bearing file metadata and redacts untrusted Git text before persistence. */
export function sanitizeGitSnapshot(
  snapshot: GitSnapshot,
  options: SecretPathOptions = {}
): GitSnapshot {
  const files = filterSecretFiles(snapshot.files, options).map((file) => ({
    ...file,
    path: redactSecrets(file.path),
    previousPath: file.previousPath ? redactSecrets(file.previousPath) : null
  }))
  return gitSnapshotSchema.parse({
    ...snapshot,
    branch: redactSecrets(snapshot.branch),
    isClean: files.length === 0,
    files,
    counts: countsFor(files),
    diffStats: {
      filesChanged: files.length,
      insertions: files.reduce((total, file) => total + (file.additions ?? 0), 0),
      deletions: files.reduce((total, file) => total + (file.deletions ?? 0), 0)
    },
    recentCommits: snapshot.recentCommits.map((commit) => ({
      ...commit,
      subject: redactSecrets(commit.subject),
      authorName: redactSecrets(commit.authorName)
    }))
  })
}

/** Applies value redaction before user-authored context is persisted or exported. */
export function sanitizeCheckpointContext(context: CheckpointContext): CheckpointContext {
  const sanitized = redactSensitiveValues(context)
  return checkpointContextSchema.parse({
    ...sanitized,
    tags: sanitized.tags.map((tag) => redactSecrets(tag)).filter(Boolean),
    links: sanitized.links.map((link) => redactSecrets(link))
  })
}
