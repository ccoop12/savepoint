import type { CheckpointContext, GitSnapshot } from '../../src/shared'

export function context(overrides: Partial<CheckpointContext> = {}): CheckpointContext {
  return {
    title: 'Finish repository support',
    goal: 'Make checkpoint persistence reliable',
    completed: 'Added migrations',
    nextAction: 'Run integration tests',
    blockers: '',
    notes: 'Local metadata only',
    tags: ['backend', 'sqlite'],
    links: ['https://example.com/issue/42'],
    commands: ['npm test'],
    ...overrides
  }
}

export function snapshot(overrides: Partial<GitSnapshot> = {}): GitSnapshot {
  return {
    branch: 'main',
    commitHash: '1234567890abcdef1234567890abcdef12345678',
    shortCommitHash: '1234567',
    isClean: false,
    files: [
      {
        path: 'src/main.ts',
        status: 'modified',
        staged: false,
        previousPath: null,
        additions: 8,
        deletions: 2
      }
    ],
    counts: {
      staged: 0,
      modified: 1,
      added: 0,
      deleted: 0,
      renamed: 0,
      copied: 0,
      untracked: 0,
      conflicted: 0
    },
    diffStats: { filesChanged: 1, insertions: 8, deletions: 2 },
    recentCommits: [
      {
        hash: 'abcdef1234567890abcdef1234567890abcdef12',
        shortHash: 'abcdef1',
        subject: 'feat: add repository persistence',
        authorName: 'SavePoint Test',
        authoredAt: '2026-01-10T12:00:00.000Z'
      }
    ],
    ...overrides
  }
}
