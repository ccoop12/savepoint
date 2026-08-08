import { describe, expect, it } from 'vitest'
import {
  buildCheckpoint,
  createCheckpointFingerprint,
  fingerprintValue,
  isDuplicateCheckpointState,
  stableStringify
} from '../../src/shared'
import { makeCheckpoint, makeContext, makeGitFile, makeGitSnapshot } from './fixtures'

describe('checkpoint fingerprints and deduplication', () => {
  it('canonicalizes object keys and produces a stable 64-character fingerprint', () => {
    expect(stableStringify({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}')
    expect(fingerprintValue({ a: 1 })).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprintValue({ a: 1 })).toBe(fingerprintValue({ a: 1 }))
    expect(fingerprintValue({ a: 1 })).not.toBe(fingerprintValue({ a: 2 }))
  })

  it('does not treat file ordering or human-context edits as a Git state change', () => {
    const first = makeGitFile({ path: 'a.ts' })
    const second = makeGitFile({ path: 'b.ts', status: 'added' })
    const leftGit = makeGitSnapshot({ files: [first, second] })
    const rightGit = makeGitSnapshot({ files: [second, first] })
    const left = makeCheckpoint({ git: leftGit, context: makeContext({ goal: 'First wording' }) })
    const right = makeCheckpoint({
      id: 'checkpoint-2',
      git: rightGit,
      context: makeContext({ goal: 'Reworded goal' }),
      fingerprint: createCheckpointFingerprint(rightGit)
    })
    expect(isDuplicateCheckpointState(left, right)).toBe(true)
  })

  it('detects meaningful changes to commit, status, staging, or diff metadata', () => {
    const base = makeGitSnapshot()
    const staged = makeGitSnapshot({ files: [makeGitFile({ staged: true })] })
    const newCommit = makeGitSnapshot({
      commitHash: '1123456789abcdef0123456789abcdef01234567',
      shortCommitHash: '1123456'
    })
    expect(createCheckpointFingerprint(base)).not.toBe(createCheckpointFingerprint(staged))
    expect(createCheckpointFingerprint(base)).not.toBe(createCheckpointFingerprint(newCommit))
  })

  it('ignores secret-only file changes when deduplicating automatic state', () => {
    const withoutSecret = makeGitSnapshot({ files: [makeGitFile()] })
    const withSecret = makeGitSnapshot({
      files: [makeGitFile(), makeGitFile({ path: '.env.local', additions: 99, deletions: 50 })]
    })
    expect(createCheckpointFingerprint(withoutSecret)).toBe(createCheckpointFingerprint(withSecret))
  })

  it('filters secret paths and redacts values while building a persistable checkpoint', () => {
    const git = makeGitSnapshot({ files: [makeGitFile(), makeGitFile({ path: '.env.local' })] })
    const checkpoint = buildCheckpoint(
      {
        repositoryId: 'repository-1',
        origin: 'manual',
        context: makeContext({ notes: 'api_key=should-not-survive' }),
        git
      },
      { id: 'built-id', createdAt: '2026-02-03T04:05:06.000Z' }
    )
    expect(checkpoint.git.files.map((file) => file.path)).toEqual(['src/index.ts'])
    expect(checkpoint.git.counts.modified).toBe(1)
    expect(checkpoint.git.diffStats).toEqual({ filesChanged: 1, insertions: 4, deletions: 1 })
    expect(checkpoint.context.notes).not.toContain('should-not-survive')
    expect(checkpoint.fingerprint).toBe(createCheckpointFingerprint(checkpoint.git))
  })
})
