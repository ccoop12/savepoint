import { describe, expect, it } from 'vitest'
import { compareCheckpoints } from '../../src/shared'
import { makeCheckpoint, makeContext, makeGitFile, makeGitSnapshot } from './fixtures'

describe('checkpoint comparison', () => {
  it('reports repository, Git, file-set, status, and context changes', () => {
    const base = makeCheckpoint({
      git: makeGitSnapshot({
        files: [
          makeGitFile({ path: 'both.ts' }),
          makeGitFile({ path: 'removed.ts', status: 'deleted' })
        ]
      })
    })
    const targetGit = makeGitSnapshot({
      branch: 'feature/next',
      commitHash: 'abcdef0123456789abcdef0123456789abcdef01',
      shortCommitHash: 'abcdef0',
      files: [
        makeGitFile({ path: 'both.ts', status: 'added', staged: true }),
        makeGitFile({ path: 'added.ts', status: 'untracked', additions: null, deletions: null })
      ]
    })
    const target = makeCheckpoint({
      id: 'checkpoint-2',
      createdAt: '2026-01-02T12:05:00.000Z',
      git: targetGit,
      context: makeContext({ goal: 'A new goal', blockers: 'Waiting on review' })
    })

    const result = compareCheckpoints(base, target)
    expect(result.elapsedMilliseconds).toBe(5 * 60_000)
    expect(result.branch).toMatchObject({
      before: 'feature/save-context',
      after: 'feature/next',
      changed: true
    })
    expect(result.commit.changed).toBe(true)
    expect(result.files.added.map((file) => file.path)).toEqual(['added.ts'])
    expect(result.files.removed.map((file) => file.path)).toEqual(['removed.ts'])
    expect(result.files.changedInBoth.map((change) => change.path)).toEqual(['both.ts'])
    expect(result.files.statusChanges.map((change) => change.path)).toEqual(['both.ts'])
    expect(result.context.goal).toMatchObject({ changed: true, after: 'A new goal' })
    expect(result.context.blockers.changed).toBe(true)
  })

  it('retains unchanged file metadata separately', () => {
    const base = makeCheckpoint()
    const target = makeCheckpoint({ id: 'checkpoint-2', createdAt: '2026-01-02T13:00:00.000Z' })
    expect(compareCheckpoints(base, target).files.unchanged).toHaveLength(1)
  })

  it('refuses to compare checkpoints from different repositories', () => {
    expect(() =>
      compareCheckpoints(
        makeCheckpoint(),
        makeCheckpoint({ id: 'other', repositoryId: 'repository-2' })
      )
    ).toThrow(/different repositories/i)
  })
})
