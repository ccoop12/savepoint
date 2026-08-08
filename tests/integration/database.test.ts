import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { REDACTION_MARKER } from '../../src/shared'
import { SavePointDatabase, latestSchemaVersion } from '../../src/main/services/database'
import { context, snapshot } from './helpers'

const temporaryDirectories: string[] = []

async function temporaryDatabase(): Promise<{
  directory: string
  path: string
  database: SavePointDatabase
}> {
  const directory = await mkdtemp(join(tmpdir(), 'savepoint-db-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'savepoint.sqlite3')
  let nextId = 0
  let nextTime = Date.parse('2026-02-01T10:00:00.000Z')
  const database = await SavePointDatabase.open({
    filePath: path,
    idFactory: () => `test-id-${++nextId}`,
    now: () => new Date((nextTime += 1_000))
  })
  return { directory, path, database }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('SavePointDatabase', () => {
  it('creates a SQLite file and applies every versioned migration', async () => {
    const { path, database } = await temporaryDatabase()

    expect(database.schemaVersion).toBe(latestSchemaVersion)
    expect(database.listMigrations()).toEqual([
      expect.objectContaining({ version: 1, name: 'initial_local_store' }),
      expect.objectContaining({ version: 2, name: 'query_indexes' })
    ])
    expect((await readFile(path)).subarray(0, 15).toString()).toBe('SQLite format 3')

    await database.close()
  })

  it('registers and updates repositories and settings', async () => {
    const { database } = await temporaryDatabase()
    const repository = await database.registerRepository('/tmp/fictional-repo', 'fictional-repo')

    expect(database.listRepositories()).toEqual([repository])
    expect(await database.registerRepository('/tmp/fictional-repo', 'ignored-name')).toEqual(
      repository
    )

    const updated = await database.updateRepository({
      id: repository.id,
      autoCheckpointEnabled: true,
      autoCheckpointIntervalMinutes: 25,
      exclusionPatterns: ['build/**', ' build/** ', '*.private']
    })
    expect(updated).toMatchObject({
      autoCheckpointEnabled: true,
      autoCheckpointIntervalMinutes: 25,
      exclusionPatterns: ['build/**', '*.private']
    })

    expect(database.getSettings()).toEqual({
      theme: 'dark',
      defaultAutoCheckpointIntervalMinutes: 10,
      onboardingComplete: false
    })
    expect(await database.updateSettings({ theme: 'light', onboardingComplete: true })).toEqual({
      theme: 'light',
      defaultAutoCheckpointIntervalMinutes: 10,
      onboardingComplete: true
    })
    await database.close()
  })

  it('persists, reloads, updates, searches, filters, and deletes checkpoints', async () => {
    const { path, database } = await temporaryDatabase()
    const repository = await database.registerRepository('/tmp/reloadable', 'reloadable')
    const manual = await database.createCheckpoint({
      repositoryId: repository.id,
      origin: 'manual',
      context: context({
        title: 'Reach 100% migration confidence',
        goal: 'Verify reload behavior',
        tags: ['Persistence', 'Release']
      }),
      git: snapshot()
    })
    const automatic = await database.createCheckpoint({
      repositoryId: repository.id,
      origin: 'automatic',
      context: context({ title: 'Automatic checkpoint', tags: ['background'] }),
      git: snapshot({
        branch: 'feature/reload',
        commitHash: '2234567890abcdef1234567890abcdef12345678',
        shortCommitHash: '2234567'
      })
    })

    expect(database.listCheckpoints({ search: '100%' }).map(({ id }) => id)).toEqual([manual.id])
    expect(database.listCheckpoints({ tag: 'persistence' }).map(({ id }) => id)).toEqual([
      manual.id
    ])
    expect(database.listCheckpoints({ branch: 'feature/reload', origin: 'automatic' })).toEqual([
      automatic
    ])

    const edited = await database.updateCheckpoint({
      id: manual.id,
      context: { nextAction: 'Ship it', tags: ['verified'] }
    })
    expect(edited.context.nextAction).toBe('Ship it')
    expect(edited.context.tags).toEqual(['verified'])

    await database.close()
    const reloaded = await SavePointDatabase.open({ filePath: path })
    expect(reloaded.getCheckpoint(manual.id)).toEqual(edited)
    expect(reloaded.latestCheckpoint(repository.id)?.id).toBe(automatic.id)

    expect(await reloaded.deleteCheckpoint(manual.id)).toBe(true)
    expect(reloaded.getCheckpoint(manual.id)).toBeNull()
    expect(await reloaded.deleteCheckpoint(manual.id)).toBe(false)
    expect(await reloaded.removeRepository(repository.id)).toBe(true)
    expect(reloaded.getCheckpoint(automatic.id)).toBeNull()
    await reloaded.close()
  })

  it('filters secret paths and redacts secret-like context before persistence', async () => {
    const { database } = await temporaryDatabase()
    const repository = await database.registerRepository('/tmp/private', 'private')
    const checkpoint = await database.createCheckpoint({
      repositoryId: repository.id,
      origin: 'manual',
      context: context({ notes: 'api_key=super-secret-value' }),
      git: snapshot({
        files: [
          ...snapshot().files,
          {
            path: '.env.production',
            status: 'modified',
            staged: false,
            previousPath: null,
            additions: 1,
            deletions: 1
          },
          {
            path: 'certificates/signing.pem',
            status: 'untracked',
            staged: false,
            previousPath: null,
            additions: null,
            deletions: null
          }
        ]
      })
    })

    expect(checkpoint.git.files.map(({ path }) => path)).toEqual(['src/main.ts'])
    expect(checkpoint.context.notes).toContain(REDACTION_MARKER)
    expect(checkpoint.context.notes).not.toContain('super-secret-value')
    expect(database.getCheckpoint(checkpoint.id)).toEqual(checkpoint)
    await database.close()
  })
})
