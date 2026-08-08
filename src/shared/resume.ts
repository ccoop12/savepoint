import {
  checkpointSchema,
  gitSnapshotSchema,
  type Checkpoint,
  type GitFile,
  type GitSnapshot
} from './schemas'
import { redactSecrets, sanitizeCheckpointContext, sanitizeGitSnapshot } from './security'

export interface ResumeStateDifference {
  branchChanged: boolean
  commitChanged: boolean
  cleanStateChanged: boolean
  checkpointBranch: string
  currentBranch: string
  checkpointCommit: string
  currentCommit: string
  filesAddedSinceCheckpoint: string[]
  filesRemovedSinceCheckpoint: string[]
  filesChangedSinceCheckpoint: string[]
}

export interface ResumeSummary {
  checkpointId: string
  title: string
  capturedAt: string
  whatYouWereDoing: string
  completed: string
  remains: string
  nextRecommendedAction: string
  blockers: string
  notes: string
  branch: string
  commitHash: string
  changedFiles: Array<Pick<GitFile, 'path' | 'status' | 'staged'>>
  commands: string[]
  links: string[]
  checkoutCommand: string | null
  currentStateDifference: ResumeStateDifference | null
  markdown: string
  assistantContext: string
}

function compareCurrentState(checkpoint: Checkpoint, current: GitSnapshot): ResumeStateDifference {
  const checkpointFiles = new Map(checkpoint.git.files.map((file) => [file.path, file]))
  const currentFiles = new Map(current.files.map((file) => [file.path, file]))
  const filesAddedSinceCheckpoint = [...currentFiles.keys()].filter(
    (path) => !checkpointFiles.has(path)
  )
  const filesRemovedSinceCheckpoint = [...checkpointFiles.keys()].filter(
    (path) => !currentFiles.has(path)
  )
  const filesChangedSinceCheckpoint = [...currentFiles.entries()]
    .filter(([path, file]) => {
      const previous = checkpointFiles.get(path)
      return (
        previous &&
        (previous.status !== file.status ||
          previous.staged !== file.staged ||
          previous.previousPath !== file.previousPath ||
          previous.additions !== file.additions ||
          previous.deletions !== file.deletions)
      )
    })
    .map(([path]) => path)
  const sort = (values: string[]): string[] =>
    values.sort((left, right) => left.localeCompare(right, 'en'))
  return {
    branchChanged: checkpoint.git.branch !== current.branch,
    commitChanged: checkpoint.git.commitHash !== current.commitHash,
    cleanStateChanged: checkpoint.git.isClean !== current.isClean,
    checkpointBranch: checkpoint.git.branch,
    currentBranch: current.branch,
    checkpointCommit: checkpoint.git.commitHash,
    currentCommit: current.commitHash,
    filesAddedSinceCheckpoint: sort(filesAddedSinceCheckpoint),
    filesRemovedSinceCheckpoint: sort(filesRemovedSinceCheckpoint),
    filesChangedSinceCheckpoint: sort(filesChangedSinceCheckpoint)
  }
}

function truncate(value: string, maximum = 800): string {
  const clean = value.trim()
  return clean.length <= maximum ? clean : `${clean.slice(0, maximum - 1).trimEnd()}…`
}

function safeCheckoutCommand(branch: string): string | null {
  return /^(?![-./])(?!.+\.lock$)[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)
    ? `git switch -- ${branch}`
    : null
}

function escapeMarkdown(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function generateResumeSummary(
  checkpoint: Checkpoint,
  currentState?: GitSnapshot | null
): ResumeSummary {
  const safeCheckpoint = checkpointSchema.parse({
    ...checkpoint,
    context: sanitizeCheckpointContext(checkpoint.context),
    git: sanitizeGitSnapshot(checkpoint.git)
  })
  const safeCurrentState = currentState
    ? sanitizeGitSnapshot(gitSnapshotSchema.parse(currentState))
    : null
  const context = safeCheckpoint.context
  const files = safeCheckpoint.git.files.map(({ path, status, staged }) => ({
    path,
    status,
    staged
  }))
  const difference = safeCurrentState ? compareCurrentState(safeCheckpoint, safeCurrentState) : null
  const whatYouWereDoing = context.goal || context.title || 'No goal was recorded.'
  const remains = context.nextAction || 'Review the checkpoint and choose the next task.'
  const nextRecommendedAction = context.nextAction || 'Review the changed files before continuing.'
  const blockers = context.blockers || 'No blockers recorded.'
  const driftLines = difference
    ? [
        '',
        '## Repository now',
        '',
        `- Branch: ${difference.currentBranch}${difference.branchChanged ? ` (was ${difference.checkpointBranch})` : ''}`,
        `- Commit: ${difference.currentCommit}${difference.commitChanged ? ` (was ${difference.checkpointCommit})` : ''}`,
        `- File-set changes since capture: +${difference.filesAddedSinceCheckpoint.length} / -${difference.filesRemovedSinceCheckpoint.length} / ~${difference.filesChangedSinceCheckpoint.length}`
      ]
    : []
  const markdown = [
    `# Resume: ${escapeMarkdown(redactSecrets(context.title || 'Untitled checkpoint'))}`,
    '',
    `Captured ${safeCheckpoint.createdAt} on \`${escapeMarkdown(safeCheckpoint.git.branch)}\` at \`${safeCheckpoint.git.shortCommitHash}\`.`,
    '',
    '## What you were doing',
    '',
    escapeMarkdown(redactSecrets(whatYouWereDoing)),
    '',
    '## Completed',
    '',
    escapeMarkdown(redactSecrets(context.completed || 'Nothing recorded.')),
    '',
    '## Next action',
    '',
    escapeMarkdown(redactSecrets(nextRecommendedAction)),
    '',
    '## Blockers',
    '',
    escapeMarkdown(redactSecrets(blockers)),
    '',
    '## Notes',
    '',
    escapeMarkdown(redactSecrets(context.notes || 'No notes recorded.')),
    ...driftLines
  ].join('\n')

  const assistantContext = [
    `Resume development checkpoint "${truncate(redactSecrets(context.title || 'Untitled checkpoint'), 200)}".`,
    `Goal: ${truncate(redactSecrets(whatYouWereDoing))}`,
    `Completed: ${truncate(redactSecrets(context.completed || 'Not recorded.'))}`,
    `Next: ${truncate(redactSecrets(nextRecommendedAction))}`,
    `Blockers: ${truncate(redactSecrets(blockers))}`,
    `Notes: ${truncate(redactSecrets(context.notes || 'Not recorded.'))}`,
    `Git: branch ${safeCheckpoint.git.branch}, commit ${safeCheckpoint.git.shortCommitHash}, ${safeCheckpoint.git.isClean ? 'clean' : `${files.length} changed file(s)`}.`,
    difference && (difference.branchChanged || difference.commitChanged)
      ? `Current repository: branch ${difference.currentBranch}, commit ${difference.currentCommit.slice(0, 12)}.`
      : ''
  ]
    .filter(Boolean)
    .join('\n')

  return {
    checkpointId: safeCheckpoint.id,
    title: context.title || 'Untitled checkpoint',
    capturedAt: safeCheckpoint.createdAt,
    whatYouWereDoing,
    completed: context.completed,
    remains,
    nextRecommendedAction,
    blockers,
    notes: context.notes,
    branch: safeCheckpoint.git.branch,
    commitHash: safeCheckpoint.git.commitHash,
    changedFiles: files,
    commands: context.commands,
    links: context.links,
    checkoutCommand: safeCheckoutCommand(safeCheckpoint.git.branch),
    currentStateDifference: difference,
    markdown,
    assistantContext
  }
}

export const createResumeSummary = generateResumeSummary
