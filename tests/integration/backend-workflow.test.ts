import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { simpleGit } from 'simple-git'
import { afterEach, describe, expect, it } from 'vitest'

import { SavePointDatabase } from '../../src/main/services/database'
import { GitCaptureService } from '../../src/main/services/git-capture'
import { SavePointService } from '../../src/main/services/savepoint-service'
import { context } from './helpers'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('main-process checkpoint workflow', () => {
  it('registers a real repository, captures fresh state, and reloads the checkpoint', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'savepoint-workflow-'))
    temporaryDirectories.push(directory)
    const repositoryPath = join(directory, 'project')
    const databasePath = join(directory, 'data', 'savepoint.sqlite3')
    await mkdir(repositoryPath, { recursive: true })
    const repositoryGit = simpleGit(repositoryPath)
    await repositoryGit.init()
    await repositoryGit.addConfig('user.name', 'SavePoint Test', false, 'local')
    await repositoryGit.addConfig('user.email', 'savepoint@example.invalid', false, 'local')
    await writeFile(join(repositoryPath, 'app.ts'), 'export const version = 1\n')
    await repositoryGit.add('app.ts')
    await repositoryGit.commit('test: initial checkpoint fixture')
    await writeFile(join(repositoryPath, 'app.ts'), 'export const version = 2\n')

    const database = await SavePointDatabase.open({ filePath: databasePath })
    const service = new SavePointService(database, new GitCaptureService())
    await service.updateSettings({ defaultAutoCheckpointIntervalMinutes: 20 })
    const repository = await service.registerRepository({ path: repositoryPath })
    expect(repository.autoCheckpointIntervalMinutes).toBe(20)
    const preview = await service.refreshRepository(repository.id)
    expect(preview.files.map(({ path }) => path)).toEqual(['app.ts'])

    const checkpoint = await service.createCheckpoint({
      repositoryId: repository.id,
      context: context({ title: 'Upgrade the fixture' })
    })
    expect(checkpoint.origin).toBe('manual')
    expect(checkpoint.git.files.map(({ path }) => path)).toEqual(['app.ts'])
    expect(checkpoint.git.commitHash).toBe(preview.commitHash)
    await service.updateSettings({ defaultAutoCheckpointIntervalMinutes: 30 })
    expect(database.getSettings().defaultAutoCheckpointIntervalMinutes).toBe(30)
    expect(database.getRepository(repository.id)?.autoCheckpointIntervalMinutes).toBe(20)
    await database.close()

    const reloaded = await SavePointDatabase.open({ filePath: databasePath })
    expect(reloaded.getCheckpoint(checkpoint.id)).toEqual(checkpoint)
    await reloaded.close()
  })
})
