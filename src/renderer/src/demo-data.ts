import type { AppSnapshot, Checkpoint, Repository } from './types'

const repo: Repository = {
  id: 'repo-orbit-notes',
  name: 'orbit-notes',
  path: '/workspace/orbit-notes',
  branch: 'feature/offline-sync',
  headCommit: '54f0bc9d1a7e3ec27ee79c15ab64fcb478341c82',
  shortCommit: '54f0bc9',
  isClean: false,
  counts: { modified: 4, added: 2, deleted: 1, renamed: 0, staged: 2, untracked: 1 },
  latestCheckpointAt: '2026-08-06T20:42:00.000Z',
  latestGoal: 'Make queued edits survive a network drop without duplicate writes.',
  latestNextAction: 'Add the reconnect race test, then review the queue flush boundary.',
  autoCheckpointEnabled: true,
  autoCheckpointIntervalMinutes: 15,
  exclusionPatterns: ['fixtures/private/**', '*.p12'],
  createdAt: '2026-07-29T14:00:00.000Z'
}

const forgeRepo: Repository = {
  id: 'repo-forge-cli',
  name: 'forge-cli',
  path: '/workspace/forge-cli',
  branch: 'main',
  headCommit: '9db74cf188d47b86a802ffbeedf7702ce633ade1',
  shortCommit: '9db74cf',
  isClean: true,
  counts: { modified: 0, added: 0, deleted: 0, renamed: 0, staged: 0, untracked: 0 },
  latestCheckpointAt: '2026-08-04T16:10:00.000Z',
  latestGoal: 'Prepare the 1.8 release candidate.',
  latestNextAction: 'Run the cross-platform smoke matrix.',
  autoCheckpointEnabled: false,
  autoCheckpointIntervalMinutes: 30,
  exclusionPatterns: ['release/private/**'],
  createdAt: '2026-08-01T13:24:00.000Z'
}

const commits = [
  {
    hash: '54f0bc9d1a7e3ec27ee79c15ab64fcb478341c82',
    shortHash: '54f0bc9',
    message: 'feat(sync): persist pending mutation queue',
    author: 'Avery Chen',
    authoredAt: '2026-08-06T19:58:00.000Z'
  },
  {
    hash: '8ab21de43c9981308a91f975f81bd9d16370faef',
    shortHash: '8ab21de',
    message: 'test(sync): cover offline note creation',
    author: 'Avery Chen',
    authoredAt: '2026-08-06T18:21:00.000Z'
  },
  {
    hash: '325ccb18958803050762dc20f320de647eb5c43a',
    shortHash: '325ccb1',
    message: 'refactor: isolate transport retry policy',
    author: 'Mina Park',
    authoredAt: '2026-08-05T21:11:00.000Z'
  }
]

const checkpoints: Checkpoint[] = [
  {
    id: 'cp-reconnect-tests',
    repositoryId: repo.id,
    createdAt: '2026-08-06T20:42:00.000Z',
    updatedAt: '2026-08-06T20:42:00.000Z',
    origin: 'manual',
    title: 'Queue persistence is wired',
    goal: 'Make queued edits survive a network drop without duplicate writes.',
    completed:
      'Moved the mutation queue into IndexedDB, added idempotency keys, and covered the cold-start restore path.',
    nextAction: 'Add the reconnect race test, then review the queue flush boundary.',
    blockers: 'Need a decision on whether 409 responses should retry or enter conflict resolution.',
    notes:
      'The queue owns retry timing; the transport should stay stateless. Keep the UI badge driven by queue depth.',
    tags: ['offline', 'sync', 'needs-test'],
    urls: ['https://github.com/example/orbit-notes/issues/184'],
    commands: ['npm run test -- sync-queue', 'npm run dev -- --offline'],
    branch: 'feature/offline-sync',
    fullCommitHash: repo.headCommit,
    shortCommitHash: repo.shortCommit,
    isClean: false,
    files: [
      {
        path: 'src/sync/mutation-queue.ts',
        status: 'modified',
        staged: true,
        insertions: 86,
        deletions: 24
      },
      {
        path: 'src/sync/idempotency.ts',
        status: 'added',
        staged: true,
        insertions: 48,
        deletions: 0
      },
      {
        path: 'src/hooks/use-sync-state.ts',
        status: 'modified',
        staged: false,
        insertions: 19,
        deletions: 7
      },
      {
        path: 'tests/sync/offline-create.test.ts',
        status: 'modified',
        staged: false,
        insertions: 42,
        deletions: 5
      },
      {
        path: 'tests/sync/reconnect-race.test.ts',
        status: 'untracked',
        staged: false,
        insertions: 17,
        deletions: 0
      },
      {
        path: 'src/sync/legacy-buffer.ts',
        status: 'deleted',
        staged: false,
        insertions: 0,
        deletions: 61
      }
    ],
    diffStats: { filesChanged: 6, insertions: 212, deletions: 97 },
    recentCommits: commits
  },
  {
    id: 'cp-offline-baseline',
    repositoryId: repo.id,
    createdAt: '2026-08-06T17:18:00.000Z',
    updatedAt: '2026-08-06T17:18:00.000Z',
    origin: 'automatic',
    title: 'Offline creation baseline',
    goal: 'Prove note creation works while disconnected.',
    completed: 'Added the first offline creation path and an in-memory pending queue.',
    nextAction: 'Persist the queue across reloads.',
    blockers: '',
    notes: 'Automatic checkpoint created after the working tree settled.',
    tags: ['offline', 'sync'],
    urls: [],
    commands: ['npm run test -- offline-create'],
    branch: 'feature/offline-sync',
    fullCommitHash: '8ab21de43c9981308a91f975f81bd9d16370faef',
    shortCommitHash: '8ab21de',
    isClean: false,
    files: [
      {
        path: 'src/sync/mutation-queue.ts',
        status: 'added',
        staged: false,
        insertions: 55,
        deletions: 0
      },
      {
        path: 'tests/sync/offline-create.test.ts',
        status: 'added',
        staged: false,
        insertions: 39,
        deletions: 0
      },
      {
        path: 'src/hooks/use-sync-state.ts',
        status: 'modified',
        staged: false,
        insertions: 11,
        deletions: 4
      }
    ],
    diffStats: { filesChanged: 3, insertions: 105, deletions: 4 },
    recentCommits: commits.slice(1)
  },
  {
    id: 'cp-sync-plan',
    repositoryId: repo.id,
    createdAt: '2026-08-05T21:36:00.000Z',
    updatedAt: '2026-08-05T21:36:00.000Z',
    origin: 'manual',
    title: 'Sync boundary mapped',
    goal: 'Choose a safe ownership boundary for offline mutations.',
    completed: 'Traced transport calls and documented the queue lifecycle.',
    nextAction: 'Build the smallest queue behind the existing mutation hook.',
    blockers: 'None.',
    notes: 'Do not put persistence into the transport client.',
    tags: ['architecture', 'sync'],
    urls: ['https://github.com/example/orbit-notes/discussions/71'],
    commands: ['rg "mutateNote" src'],
    branch: 'feature/offline-sync',
    fullCommitHash: '325ccb18958803050762dc20f320de647eb5c43a',
    shortCommitHash: '325ccb1',
    isClean: false,
    files: [
      {
        path: 'docs/sync-lifecycle.md',
        status: 'added',
        staged: true,
        insertions: 74,
        deletions: 0
      },
      {
        path: 'src/api/transport.ts',
        status: 'modified',
        staged: false,
        insertions: 9,
        deletions: 12
      },
      {
        path: 'src/sync/mutation-queue.ts',
        status: 'added',
        staged: false,
        insertions: 21,
        deletions: 0
      }
    ],
    diffStats: { filesChanged: 3, insertions: 104, deletions: 12 },
    recentCommits: commits.slice(2)
  },
  {
    id: 'cp-forge-release',
    repositoryId: forgeRepo.id,
    createdAt: '2026-08-04T16:10:00.000Z',
    updatedAt: '2026-08-04T16:10:00.000Z',
    origin: 'manual',
    title: 'Release candidate ready',
    goal: 'Prepare the 1.8 release candidate.',
    completed: 'Updated changelog, generated checksums, and verified the Linux package.',
    nextAction: 'Run the cross-platform smoke matrix.',
    blockers: 'Waiting for the Windows arm64 runner.',
    notes: 'Tag only after all three smoke jobs pass.',
    tags: ['release', 'v1.8'],
    urls: ['https://github.com/example/forge-cli/actions'],
    commands: ['npm run package', 'sha256sum dist/*'],
    branch: 'main',
    fullCommitHash: forgeRepo.headCommit,
    shortCommitHash: forgeRepo.shortCommit,
    isClean: true,
    files: [],
    diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
    recentCommits: [
      {
        hash: forgeRepo.headCommit,
        shortHash: forgeRepo.shortCommit,
        message: 'chore: prepare 1.8.0 release',
        author: 'Theo Brooks',
        authoredAt: '2026-08-04T15:55:00.000Z'
      }
    ]
  },
  {
    id: 'cp-forge-package-plan',
    repositoryId: forgeRepo.id,
    createdAt: '2026-08-03T18:35:00.000Z',
    updatedAt: '2026-08-03T18:35:00.000Z',
    origin: 'automatic',
    title: 'Packaging matrix defined',
    goal: 'Prepare a repeatable 1.8 packaging matrix.',
    completed: 'Mapped required operating systems and added the Linux smoke job.',
    nextAction: 'Generate release checksums and verify Windows packaging.',
    blockers: 'None.',
    notes: 'Keep signing explicitly out of scope for the preview release.',
    tags: ['release', 'packaging'],
    urls: ['https://github.com/example/forge-cli/actions'],
    commands: ['npm run package -- --linux'],
    branch: 'release/1.8',
    fullCommitHash: '81f2d4e5a7b9c31d60e8f246ace9b84b29874a11',
    shortCommitHash: '81f2d4e',
    isClean: false,
    files: [
      {
        path: 'electron-builder.yml',
        status: 'modified',
        staged: false,
        insertions: 14,
        deletions: 3
      },
      {
        path: '.github/workflows/release.yml',
        status: 'added',
        staged: true,
        insertions: 58,
        deletions: 0
      }
    ],
    diffStats: { filesChanged: 2, insertions: 72, deletions: 3 },
    recentCommits: []
  }
]

// The controlled demo models one small change after the latest checkpoint so the resume
// briefing exercises the same current-state drift surface used by the native application.
repo.headCommit = '61a2e8ba9f16a3cd2e3d25e74fc0595ab934b10f'
repo.shortCommit = '61a2e8b'

export const demoSnapshot: AppSnapshot = {
  repositories: [repo, forgeRepo],
  checkpoints,
  settings: {
    theme: 'dark',
    autoCheckpointMinutes: 10,
    exclusionPatterns: ['.env*', '*.pem', '*.key', 'credentials.*'],
    compactTimeline: false
  }
}
