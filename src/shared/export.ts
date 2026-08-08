import { checkpointSchema, type Checkpoint, type GitFile } from './schemas'
import {
  redactSecrets,
  redactSensitiveValues,
  sanitizeCheckpointContext,
  sanitizeGitSnapshot
} from './security'

export interface CheckpointExportOptions {
  repositoryName?: string
  exportedAt?: string | Date
}

export interface CheckpointJsonExport {
  schemaVersion: 1
  exportedAt: string
  repositoryName: string | null
  checkpoint: Checkpoint
}

function sanitizedCheckpoint(checkpoint: Checkpoint): Checkpoint {
  const parsed = checkpointSchema.parse(checkpoint)
  return checkpointSchema.parse(
    redactSensitiveValues({
      ...parsed,
      context: sanitizeCheckpointContext(parsed.context),
      git: sanitizeGitSnapshot(parsed.git)
    })
  )
}

function exportedAt(options: CheckpointExportOptions): string {
  const value = options.exportedAt ?? new Date()
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Export timestamp must be a valid date')
  return date.toISOString()
}

function sanitizedRepositoryName(repositoryName: string | undefined): string | null {
  return repositoryName === undefined ? null : redactSecrets(repositoryName)
}

function escapeActiveMarkdown(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/([\\`[\]!|])/g, '\\$1')
    .replace(/\b([a-z][a-z0-9+.-]{1,31}):/gi, '$1\\:')
    .replace(/\bwww\./gi, 'www\\.')
    .replaceAll('@', '\\@')
}

function inlineText(value: string): string {
  return value.replace(/\r\n?|\n|\t/g, ' ')
}

function escapeInline(value: string): string {
  return escapeActiveMarkdown(inlineText(value))
}

function escapeBlock(value: string): string {
  return escapeActiveMarkdown(value).replace(
    /^(\s{0,3})(#{1,6}(?:\s|$)|>(?:\s|$)|[-+*](?:\s|$)|\d+[.)](?:\s|$)|(?:=+|-+)\s*$)/gm,
    '$1\\$2'
  )
}

function inlineCode(value: string): string {
  const normalized = inlineText(value)
  const longestRun = Math.max(0, ...[...normalized.matchAll(/`+/g)].map((match) => match[0].length))
  const fence = '`'.repeat(Math.max(1, longestRun + 1))
  return `${fence} ${normalized} ${fence}`
}

function vettedHttpsAutolink(value: string): string {
  return `<${new URL(value).toString()}>`
}

function section(heading: string, value: string, fallback = '_Not recorded._'): string[] {
  return [`## ${heading}`, '', value.trim() ? escapeBlock(value.trim()) : fallback, '']
}

function fileLabel(file: GitFile): string {
  const staged = file.staged ? 'yes' : 'no'
  const renamed = file.previousPath ? ` (from ${escapeInline(file.previousPath)})` : ''
  return `| ${escapeInline(file.path)}${renamed} | ${file.status} | ${staged} | ${file.additions ?? '—'} | ${file.deletions ?? '—'} |`
}

export function exportCheckpointMarkdown(
  checkpoint: Checkpoint,
  options: CheckpointExportOptions = {}
): string {
  const safe = sanitizedCheckpoint(checkpoint)
  const repositoryName = sanitizedRepositoryName(options.repositoryName)
  const title = safe.context.title || 'Untitled checkpoint'
  const lines = [
    `# ${escapeInline(title)}`,
    '',
    '> SavePoint development-session checkpoint. File contents and complete diffs are not included.',
    '',
    '| Checkpoint | Value |',
    '| --- | --- |',
    `| Captured | ${safe.createdAt} |`,
    `| Origin | ${safe.origin} |`,
    `| Repository | ${escapeInline(repositoryName ?? safe.repositoryId)} |`,
    `| Branch | ${escapeInline(safe.git.branch)} |`,
    `| Commit | ${safe.git.commitHash} |`,
    `| Working tree | ${safe.git.isClean ? 'clean' : 'has changes'} |`,
    '',
    ...section('Goal', safe.context.goal),
    ...section('Work completed', safe.context.completed),
    ...section('Next action', safe.context.nextAction),
    ...section('Blockers', safe.context.blockers, '_None recorded._'),
    ...section('Notes', safe.context.notes),
    '## Changed files',
    ''
  ]

  if (safe.git.files.length === 0) lines.push('_No changed files captured._', '')
  else {
    lines.push(
      '| Path | Status | Staged | Additions | Deletions |',
      '| --- | --- | --- | ---: | ---: |'
    )
    lines.push(...safe.git.files.map(fileLabel), '')
  }

  lines.push(
    '## Diff statistics',
    '',
    `- Files changed: ${safe.git.diffStats.filesChanged}`,
    `- Insertions: ${safe.git.diffStats.insertions}`,
    `- Deletions: ${safe.git.diffStats.deletions}`,
    '',
    '## Recent commits',
    ''
  )
  if (safe.git.recentCommits.length === 0) lines.push('_No recent commits captured._', '')
  else {
    lines.push(
      ...safe.git.recentCommits.flatMap((commit) => [
        `- \`${commit.shortHash}\` ${escapeInline(commit.subject)} — ${escapeInline(commit.authorName)} (${commit.authoredAt})`
      ]),
      ''
    )
  }

  lines.push('## Commands', '')
  if (safe.context.commands.length === 0) lines.push('_None recorded._', '')
  else {
    for (const command of safe.context.commands) {
      const longestRun = Math.max(
        0,
        ...[...command.matchAll(/`+/g)].map((match) => match[0].length)
      )
      const fence = '`'.repeat(Math.max(3, longestRun + 1))
      lines.push(fence, command, fence, '')
    }
  }

  lines.push('## Links', '')
  if (safe.context.links.length === 0) lines.push('_None recorded._', '')
  else lines.push(...safe.context.links.map((link) => `- ${vettedHttpsAutolink(link)}`), '')

  lines.push('## Tags', '')
  if (safe.context.tags.length === 0) lines.push('_None._', '')
  else lines.push(safe.context.tags.map(inlineCode).join(' '), '')

  return `${lines.join('\n').trimEnd()}\n`
}

export function createCheckpointJsonExport(
  checkpoint: Checkpoint,
  options: CheckpointExportOptions = {}
): CheckpointJsonExport {
  return {
    schemaVersion: 1,
    exportedAt: exportedAt(options),
    repositoryName: sanitizedRepositoryName(options.repositoryName),
    checkpoint: sanitizedCheckpoint(checkpoint)
  }
}

export function exportCheckpointJson(
  checkpoint: Checkpoint,
  options: CheckpointExportOptions = {}
): string {
  return `${JSON.stringify(createCheckpointJsonExport(checkpoint, options), null, 2)}\n`
}

export const exportCheckpointJSON = exportCheckpointJson
