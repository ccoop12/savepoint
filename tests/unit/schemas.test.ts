import { describe, expect, it } from 'vitest'
import {
  checkpointContextSchema,
  checkpointSchema,
  createCheckpointInputSchema,
  createCheckpointRequestSchema,
  ipcResultSchema,
  listCheckpointsInputSchema,
  repositorySchema
} from '../../src/shared'
import { makeCheckpoint, makeContext, makeGitSnapshot } from './fixtures'

describe('shared input validation', () => {
  it('accepts a complete checkpoint and rejects unknown fields', () => {
    expect(checkpointSchema.parse(makeCheckpoint()).id).toBe('checkpoint-1')
    expect(() => checkpointSchema.parse({ ...makeCheckpoint(), surprise: true })).toThrow()
  })

  it('rejects malformed nested Git state', () => {
    const checkpoint = makeCheckpoint()
    expect(() =>
      checkpointSchema.parse({
        ...checkpoint,
        git: { ...checkpoint.git, files: [{ ...checkpoint.git.files[0], status: 'changed' }] }
      })
    ).toThrow()
  })

  it('validates and normalizes checkpoint input defaults', () => {
    const input = createCheckpointInputSchema.parse({
      repositoryId: ' repository-1 ',
      context: makeContext({ title: '  A useful title  ' }),
      git: makeGitSnapshot()
    })
    expect(input.repositoryId).toBe('repository-1')
    expect(input.origin).toBe('manual')
    expect(input.context.title).toBe('A useful title')
  })

  it('does not let an untrusted checkpoint request choose origin or provide Git state', () => {
    const request = { repositoryId: 'repository-1', context: makeContext() }
    expect(createCheckpointRequestSchema.parse(request)).toEqual(request)
    expect(() => createCheckpointRequestSchema.parse({ ...request, origin: 'automatic' })).toThrow()
    expect(() =>
      createCheckpointRequestSchema.parse({ ...request, git: makeGitSnapshot() })
    ).toThrow()
  })

  it('enforces URLs and field limits at the IPC boundary', () => {
    expect(() =>
      checkpointContextSchema.parse({ ...makeContext(), links: ['not-a-url'] })
    ).toThrow()
    expect(() =>
      checkpointContextSchema.parse({ ...makeContext(), links: ['javascript:alert(1)'] })
    ).toThrow()
    expect(() =>
      checkpointContextSchema.parse({ ...makeContext(), links: ['http://example.test'] })
    ).toThrow()
    expect(() =>
      checkpointContextSchema.parse({ ...makeContext(), links: ['https://user:pass@example.test'] })
    ).toThrow()
    expect(() =>
      checkpointContextSchema.parse({ ...makeContext(), title: 'x'.repeat(201) })
    ).toThrow()
    expect(() => listCheckpointsInputSchema.parse({ limit: 501 })).toThrow()
  })

  it('applies repository privacy and scheduling defaults', () => {
    const repository = repositorySchema.parse({
      id: 'repo',
      name: 'demo',
      path: '/work/demo',
      createdAt: '2026-01-02T12:00:00.000Z',
      updatedAt: '2026-01-02T12:00:00.000Z'
    })
    expect(repository.autoCheckpointEnabled).toBe(false)
    expect(repository.autoCheckpointIntervalMinutes).toBe(10)
    expect(repository.exclusionPatterns).toEqual([])
  })

  it('models success and safe serializable failures', () => {
    const result = ipcResultSchema(checkpointSchema).parse({ ok: true, value: makeCheckpoint() })
    expect(result.ok).toBe(true)
    expect(() =>
      ipcResultSchema(checkpointSchema).parse({
        ok: false,
        error: { code: 'INVALID', message: 'Nope', stack: 'must not cross IPC' }
      })
    ).toThrow()
  })
})
