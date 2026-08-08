import { checkpointSchema, type Checkpoint, type CheckpointContext, type GitFile } from './schemas'
import { sanitizeCheckpointContext, sanitizeGitSnapshot } from './security'

export interface ValueChange<T> {
  before: T
  after: T
  changed: boolean
}

export interface FileChange {
  path: string
  before: GitFile
  after: GitFile
}

export interface CheckpointComparison {
  baseCheckpointId: string
  targetCheckpointId: string
  repositoryId: string
  elapsedMilliseconds: number
  branch: ValueChange<string>
  commit: ValueChange<string>
  cleanState: ValueChange<boolean>
  files: {
    added: GitFile[]
    removed: GitFile[]
    changedInBoth: FileChange[]
    unchanged: GitFile[]
    statusChanges: FileChange[]
  }
  context: {
    [
      Key in keyof Pick<
        CheckpointContext,
        'title' | 'goal' | 'completed' | 'nextAction' | 'blockers' | 'notes'
      >
    ]: ValueChange<string>
  }
}

function valueChange<T>(before: T, after: T): ValueChange<T> {
  return { before, after, changed: before !== after }
}

function sameFile(left: GitFile, right: GitFile): boolean {
  return (
    left.status === right.status &&
    left.staged === right.staged &&
    left.previousPath === right.previousPath &&
    left.additions === right.additions &&
    left.deletions === right.deletions
  )
}

function byPath(left: GitFile, right: GitFile): number {
  return left.path.localeCompare(right.path, 'en')
}

export function compareCheckpoints(base: Checkpoint, target: Checkpoint): CheckpointComparison {
  const safeBase = checkpointSchema.parse({
    ...base,
    context: sanitizeCheckpointContext(base.context),
    git: sanitizeGitSnapshot(base.git)
  })
  const safeTarget = checkpointSchema.parse({
    ...target,
    context: sanitizeCheckpointContext(target.context),
    git: sanitizeGitSnapshot(target.git)
  })
  if (safeBase.repositoryId !== safeTarget.repositoryId) {
    throw new Error('Checkpoints from different repositories cannot be compared')
  }
  const baseFiles = new Map(safeBase.git.files.map((file) => [file.path, file]))
  const targetFiles = new Map(safeTarget.git.files.map((file) => [file.path, file]))
  const added: GitFile[] = []
  const removed: GitFile[] = []
  const changedInBoth: FileChange[] = []
  const unchanged: GitFile[] = []

  for (const [path, targetFile] of targetFiles) {
    const baseFile = baseFiles.get(path)
    if (!baseFile) added.push(targetFile)
    else if (sameFile(baseFile, targetFile)) unchanged.push(targetFile)
    else changedInBoth.push({ path, before: baseFile, after: targetFile })
  }
  for (const [path, baseFile] of baseFiles) {
    if (!targetFiles.has(path)) removed.push(baseFile)
  }
  added.sort(byPath)
  removed.sort(byPath)
  unchanged.sort(byPath)
  changedInBoth.sort((left, right) => left.path.localeCompare(right.path, 'en'))

  return {
    baseCheckpointId: safeBase.id,
    targetCheckpointId: safeTarget.id,
    repositoryId: safeBase.repositoryId,
    elapsedMilliseconds:
      new Date(safeTarget.createdAt).getTime() - new Date(safeBase.createdAt).getTime(),
    branch: valueChange(safeBase.git.branch, safeTarget.git.branch),
    commit: valueChange(safeBase.git.commitHash, safeTarget.git.commitHash),
    cleanState: valueChange(safeBase.git.isClean, safeTarget.git.isClean),
    files: {
      added,
      removed,
      changedInBoth,
      unchanged,
      statusChanges: changedInBoth.filter(
        ({ before, after }) => before.status !== after.status || before.staged !== after.staged
      )
    },
    context: {
      title: valueChange(safeBase.context.title, safeTarget.context.title),
      goal: valueChange(safeBase.context.goal, safeTarget.context.goal),
      completed: valueChange(safeBase.context.completed, safeTarget.context.completed),
      nextAction: valueChange(safeBase.context.nextAction, safeTarget.context.nextAction),
      blockers: valueChange(safeBase.context.blockers, safeTarget.context.blockers),
      notes: valueChange(safeBase.context.notes, safeTarget.context.notes)
    }
  }
}
