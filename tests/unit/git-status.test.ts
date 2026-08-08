import { describe, expect, it } from 'vitest'
import { createGitSnapshot, normalizeGitStatus } from '../../src/shared'

describe('Git status normalization', () => {
  it('preserves meaningful whitespace and literal backslashes in Git filenames', () => {
    const result = normalizeGitStatus({
      current: 'main',
      files: [
        { path: ' leading name.ts ', index: ' ', workingDir: 'M' },
        { path: 'literal\\name.ts', index: ' ', workingDir: 'M' }
      ]
    })

    expect(result.files.map(({ path }) => path)).toEqual([' leading name.ts ', 'literal\\name.ts'])
  })

  it('maps porcelain status codes, stages, renames, paths, and diff statistics', () => {
    const result = normalizeGitStatus(
      {
        current: 'feature/domain',
        renamed: [{ from: 'src/old.ts', to: 'src/new.ts' }],
        files: [
          { path: 'src/changed.ts', index: 'M', workingDir: ' ' },
          { path: './src/new.ts', index: 'R', workingDir: ' ' },
          { path: 'new.txt', index: '?', workingDir: '?' },
          { path: 'deleted.ts', index: ' ', workingDir: 'D' },
          { path: 'conflict.ts', index: 'U', workingDir: 'U' }
        ]
      },
      [
        { path: 'src/changed.ts', insertions: 5, deletions: 2 },
        { path: 'src/new.ts', insertions: 1, deletions: 1 }
      ]
    )

    expect(result.files.map(({ path, status, staged }) => ({ path, status, staged }))).toEqual([
      { path: 'conflict.ts', status: 'conflicted', staged: false },
      { path: 'deleted.ts', status: 'deleted', staged: false },
      { path: 'new.txt', status: 'untracked', staged: false },
      { path: 'src/changed.ts', status: 'modified', staged: true },
      { path: 'src/new.ts', status: 'renamed', staged: true }
    ])
    expect(result.files.at(-1)?.previousPath).toBe('src/old.ts')
    expect(result.counts).toMatchObject({
      staged: 2,
      modified: 1,
      deleted: 1,
      renamed: 1,
      untracked: 1,
      conflicted: 1
    })
    expect(result.diffStats).toEqual({ filesChanged: 5, insertions: 6, deletions: 3 })
    expect(result.isClean).toBe(false)
  })

  it('ignores ignored entries when determining cleanliness', () => {
    const result = normalizeGitStatus({
      current: 'main',
      files: [{ path: 'cache.db', index: '!', workingDir: '!' }]
    })
    expect(result.isClean).toBe(true)
    expect(result.counts).toMatchObject({ staged: 0, modified: 0, untracked: 0 })
  })

  it('falls back to category lists and handles detached HEAD', () => {
    const result = normalizeGitStatus({
      detached: true,
      modified: ['a.ts'],
      notAdded: ['b.ts'],
      created: ['c.ts']
    })
    expect(result.branch).toBe('(detached HEAD)')
    expect(result.files.map((file) => file.status)).toEqual(['modified', 'untracked', 'added'])
  })

  it('creates a strictly validated snapshot without storing diff contents', () => {
    const snapshot = createGitSnapshot({
      status: { current: 'main', files: [] },
      commitHash: '0123456789abcdef0123456789abcdef01234567'
    })
    expect(snapshot.shortCommitHash).toBe('0123456')
    expect(snapshot).not.toHaveProperty('diff')
    expect(snapshot).not.toHaveProperty('contents')
  })
})
