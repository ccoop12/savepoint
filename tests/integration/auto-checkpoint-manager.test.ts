import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { GitSnapshot } from '../../src/shared'
import { AutoCheckpointManager } from '../../src/main/services/auto-checkpoint-manager'
import { SavePointDatabase } from '../../src/main/services/database'
import { GitCaptureService } from '../../src/main/services/git-capture'
import { snapshot } from './helpers'

const temporaryDirectories: string[] = []

class FakeCaptureService extends GitCaptureService {
  current: GitSnapshot = snapshot()
  onCapture?: () => Promise<void>

  override async capture(): Promise<GitSnapshot> {
    await this.onCapture?.()
    return Promise.resolve(this.current)
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('AutoCheckpointManager', () => {
  it('debounces, rate-limits, and deduplicates automatic checkpoints per repository', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'savepoint-auto-'))
    temporaryDirectories.push(directory)
    let now = Date.parse('2026-03-01T12:00:00.000Z')
    let nextId = 0
    const database = await SavePointDatabase.open({
      filePath: join(directory, 'savepoint.sqlite3'),
      now: () => new Date(now),
      idFactory: () => `auto-test-${++nextId}`
    })
    const repository = await database.registerRepository(directory, 'auto-fixture')
    await database.updateRepository({
      id: repository.id,
      autoCheckpointEnabled: true,
      autoCheckpointIntervalMinutes: 1
    })
    const capture = new FakeCaptureService()
    const manager = new AutoCheckpointManager(database, capture, {
      debounceMs: 1_000,
      now: () => new Date(now)
    })

    expect(await manager.checkNow(repository.id)).toBeNull()
    now += 1_001
    const first = await manager.checkNow(repository.id)
    expect(first).toMatchObject({ origin: 'automatic', repositoryId: repository.id })
    expect(database.listCheckpoints()).toHaveLength(1)

    now += 5_000
    expect(await manager.checkNow(repository.id)).toBeNull()
    expect(database.listCheckpoints()).toHaveLength(1)

    capture.current = snapshot({
      files: [
        ...snapshot().files,
        {
          path: 'src/new-feature.ts',
          status: 'untracked',
          staged: false,
          previousPath: null,
          additions: null,
          deletions: null
        }
      ],
      counts: { ...snapshot().counts, untracked: 1 },
      diffStats: { ...snapshot().diffStats, filesChanged: 2 }
    })
    expect(await manager.checkNow(repository.id)).toBeNull()
    now += 1_001
    expect(await manager.checkNow(repository.id)).toBeNull()

    now = new Date(first!.createdAt).getTime() + 60_001
    const second = await manager.checkNow(repository.id)
    expect(second?.fingerprint).not.toBe(first?.fingerprint)
    expect(database.listCheckpoints({ origin: 'automatic' })).toHaveLength(2)

    manager.dispose()
    await database.close()
  })

  it('discards a capture when repository privacy settings change in flight', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'savepoint-auto-config-'))
    temporaryDirectories.push(directory)
    const database = await SavePointDatabase.open({
      filePath: join(directory, 'savepoint.sqlite3')
    })
    const repository = await database.registerRepository(directory, 'auto-config-fixture')
    await database.updateRepository({ id: repository.id, autoCheckpointEnabled: true })
    const capture = new FakeCaptureService()
    capture.onCapture = async () => {
      capture.onCapture = undefined
      await database.updateRepository({
        id: repository.id,
        exclusionPatterns: ['new-private/**']
      })
    }
    const manager = new AutoCheckpointManager(database, capture, { debounceMs: 0 })

    expect(await manager.checkNow(repository.id)).toBeNull()
    expect(database.listCheckpoints()).toEqual([])

    manager.dispose()
    await database.close()
  })
})
