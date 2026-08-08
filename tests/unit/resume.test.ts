import { describe, expect, it } from 'vitest'
import { createResumeSummary, generateResumeSummary } from '../../src/shared'
import { makeCheckpoint, makeContext, makeGitFile, makeGitSnapshot } from './fixtures'

describe('resume summary generation', () => {
  it('turns a checkpoint into actionable structured and assistant-friendly context', () => {
    const checkpoint = makeCheckpoint()
    const result = generateResumeSummary(checkpoint)
    expect(result.whatYouWereDoing).toBe('Preserve the current development session')
    expect(result.completed).toBe('Normalized working-tree metadata')
    expect(result.nextRecommendedAction).toBe('Persist the checkpoint')
    expect(result.branch).toBe('feature/save-context')
    expect(result.changedFiles).toEqual([
      { path: 'src/index.ts', status: 'modified', staged: false }
    ])
    expect(result.commands).toEqual(['npm test'])
    expect(result.checkoutCommand).toBe('git switch -- feature/save-context')
    expect(result.markdown).toContain('## Next action')
    expect(result.assistantContext).toContain('Goal: Preserve the current development session')
    expect(createResumeSummary).toBe(generateResumeSummary)
  })

  it('describes drift between the checkpoint and current repository state', () => {
    const current = makeGitSnapshot({
      branch: 'main',
      commitHash: 'abcdef0123456789abcdef0123456789abcdef01',
      shortCommitHash: 'abcdef0',
      files: [
        makeGitFile({ path: 'src/index.ts', staged: true }),
        makeGitFile({ path: 'src/new.ts', status: 'added' })
      ]
    })
    const result = generateResumeSummary(makeCheckpoint(), current)
    expect(result.currentStateDifference).toMatchObject({
      branchChanged: true,
      commitChanged: true,
      filesAddedSinceCheckpoint: ['src/new.ts'],
      filesChangedSinceCheckpoint: ['src/index.ts']
    })
    expect(result.markdown).toContain('## Repository now')
    expect(result.assistantContext).toContain('Current repository: branch main')
  })

  it('uses practical fallbacks and does not create a copyable command for an unsafe branch', () => {
    const checkpoint = makeCheckpoint({
      context: makeContext({ title: '', goal: '', completed: '', nextAction: '', blockers: '' }),
      git: makeGitSnapshot({ branch: 'main; remove-everything' })
    })
    const result = generateResumeSummary(checkpoint)
    expect(result.whatYouWereDoing).toBe('No goal was recorded.')
    expect(result.nextRecommendedAction).toBe('Review the changed files before continuing.')
    expect(result.blockers).toBe('No blockers recorded.')
    expect(result.checkoutCommand).toBeNull()
  })

  it('redacts secret-like values from every generated text form', () => {
    const result = generateResumeSummary(
      makeCheckpoint({
        context: makeContext({ goal: 'Use api_key=do-not-copy', notes: 'password=nope' }),
        git: {
          ...makeCheckpoint().git,
          files: [
            ...makeCheckpoint().git.files,
            { ...makeCheckpoint().git.files[0], path: '.env.local' }
          ]
        }
      })
    )
    expect(result.whatYouWereDoing).not.toContain('do-not-copy')
    expect(result.markdown).not.toContain('do-not-copy')
    expect(result.assistantContext).not.toContain('do-not-copy')
    expect(result.changedFiles.map((file) => file.path)).not.toContain('.env.local')
  })
})
