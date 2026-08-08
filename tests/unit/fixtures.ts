import {
  createCheckpointFingerprint,
  type Checkpoint,
  type CheckpointContext,
  type GitFile,
  type GitSnapshot
} from '../../src/shared'

export function makeGitFile(overrides: Partial<GitFile> = {}): GitFile {
  return {
    path: 'src/index.ts',
    status: 'modified',
    staged: false,
    previousPath: null,
    additions: 4,
    deletions: 1,
    ...overrides
  }
}

export function makeGitSnapshot(overrides: Partial<GitSnapshot> = {}): GitSnapshot {
  const files = overrides.files ?? [makeGitFile()]
  const base: GitSnapshot = {
    branch: 'feature/save-context',
    commitHash: '0123456789abcdef0123456789abcdef01234567',
    shortCommitHash: '0123456',
    isClean: files.length === 0,
    files,
    counts: {
      staged: files.filter((file) => file.staged).length,
      modified: files.filter((file) => file.status === 'modified').length,
      added: files.filter((file) => file.status === 'added').length,
      deleted: files.filter((file) => file.status === 'deleted').length,
      renamed: files.filter((file) => file.status === 'renamed').length,
      copied: files.filter((file) => file.status === 'copied').length,
      untracked: files.filter((file) => file.status === 'untracked').length,
      conflicted: files.filter((file) => file.status === 'conflicted').length
    },
    diffStats: {
      filesChanged: files.length,
      insertions: files.reduce((total, file) => total + (file.additions ?? 0), 0),
      deletions: files.reduce((total, file) => total + (file.deletions ?? 0), 0)
    },
    recentCommits: [
      {
        hash: '0123456789abcdef0123456789abcdef01234567',
        shortHash: '0123456',
        subject: 'Add checkpoint capture',
        authorName: 'Example Developer',
        authoredAt: '2026-01-02T12:00:00.000Z'
      }
    ]
  }
  return { ...base, ...overrides, files }
}

export function makeContext(overrides: Partial<CheckpointContext> = {}): CheckpointContext {
  return {
    title: 'Capture Git context',
    goal: 'Preserve the current development session',
    completed: 'Normalized working-tree metadata',
    nextAction: 'Persist the checkpoint',
    blockers: '',
    notes: 'Keep source contents out of storage.',
    tags: ['domain', 'privacy'],
    links: ['https://example.test/issues/42'],
    commands: ['npm test'],
    ...overrides
  }
}

export function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  const git = overrides.git ?? makeGitSnapshot()
  const base: Checkpoint = {
    id: 'checkpoint-1',
    repositoryId: 'repository-1',
    createdAt: '2026-01-02T12:00:00.000Z',
    origin: 'manual',
    context: makeContext(),
    git,
    fingerprint: createCheckpointFingerprint(git)
  }
  return { ...base, ...overrides, git }
}
