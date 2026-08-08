import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { simpleGit } from 'simple-git'

const shouldRun = process.env.RUN_ELECTRON_SMOKE === '1'

test.describe('real Electron backend', () => {
  test.skip(!shouldRun, 'Run after npm run build with RUN_ELECTRON_SMOKE=1')

  test('preload IPC captures and reloads a checkpoint from a temporary Git repository', async () => {
    test.slow()
    expect(existsSync(resolve('out/main/index.js'))).toBe(true)
    expect(existsSync(resolve('out/preload/index.cjs'))).toBe(true)

    const root = await mkdtemp(join(tmpdir(), 'savepoint-electron-e2e-'))
    const repositoryPath = join(root, 'fictional-repository')
    const userDataPath = join(root, 'user-data')
    await mkdir(repositoryPath)
    const git = simpleGit(repositoryPath)
    await git.init()
    await git.addConfig('user.name', 'SavePoint Runtime Test', false, 'local')
    await git.addConfig('user.email', 'runtime@example.invalid', false, 'local')
    await writeFile(join(repositoryPath, 'README.md'), '# Runtime fixture\n')
    await git.add('README.md')
    await git.commit('test: initial runtime fixture')
    await writeFile(join(repositoryPath, 'README.md'), '# Runtime fixture\n\nCheckpoint me.\n')

    const launch = () => electron.launch({ args: [`--user-data-dir=${userDataPath}`, '.'] })

    let application: ElectronApplication | null = null
    let checkpointId: string
    let secondCheckpointId: string
    try {
      application = await launch()
      const page = await application.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await application.evaluate(({ dialog }, selectedPath) => {
        Object.defineProperty(dialog, 'showOpenDialog', {
          configurable: true,
          value: () => Promise.resolve({ canceled: false, filePaths: [selectedPath] })
        })
      }, repositoryPath)
      const created = await page.evaluate(async () => {
        const registered = await window.savepoint.repositories.selectAndRegister()
        if (!registered.ok) throw new Error(registered.error.message)
        if (!registered.value) throw new Error('Repository selection was canceled')
        const checkpoint = await window.savepoint.checkpoints.create({
          repositoryId: registered.value.id,
          context: {
            title: 'Runtime checkpoint',
            goal: 'Verify real Electron IPC',
            completed: 'Registered a temporary Git repository',
            nextAction: 'Reload the persisted checkpoint',
            blockers: '',
            notes: 'Generated integration fixture api_token=runtime-secret-value',
            tags: ['runtime'],
            links: ['https://example.com/runtime'],
            commands: ['npm test']
          }
        })
        if (!checkpoint.ok) throw new Error(checkpoint.error.message)
        return checkpoint.value
      }, repositoryPath)
      checkpointId = created.id
      expect(created.origin).toBe('manual')
      expect(created.git.files.map(({ path }) => path)).toEqual(['README.md'])
      expect(created.context.notes).toContain('[REDACTED]')
      expect(created.context.notes).not.toContain('runtime-secret-value')

      const updated = await page.evaluate(async (id) => {
        const result = await window.savepoint.checkpoints.update({
          id,
          context: {
            title: 'Runtime checkpoint updated',
            goal: 'Verify real Electron IPC and persistence',
            completed: 'Registered and captured a temporary Git repository',
            nextAction: 'Create and compare a second checkpoint',
            blockers: '',
            notes: 'Updated through the production preload bridge',
            tags: ['runtime', 'updated'],
            links: ['https://example.com/runtime'],
            commands: ['npm test']
          }
        })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      }, checkpointId)
      expect(updated.context.title).toBe('Runtime checkpoint updated')

      await writeFile(
        join(repositoryPath, 'README.md'),
        '# Runtime fixture\n\nCheckpoint me.\n\nCompare this state.\n'
      )
      const second = await page.evaluate(async (repositoryId) => {
        const result = await window.savepoint.checkpoints.create({
          repositoryId,
          context: {
            title: 'Runtime comparison checkpoint',
            goal: 'Verify checkpoint comparison',
            completed: 'Changed the temporary repository again',
            nextAction: 'Resume from persisted context',
            blockers: '',
            notes: 'Second production-backend capture',
            tags: ['runtime', 'comparison'],
            links: [],
            commands: ['git status --short']
          }
        })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      }, created.repositoryId)
      secondCheckpointId = second.id

      const comparison = await page.evaluate(
        ({ baseId, targetId }) => window.savepoint.checkpoints.compare(baseId, targetId),
        { baseId: checkpointId, targetId: secondCheckpointId }
      )
      expect(comparison.ok).toBe(true)
      if (comparison.ok) {
        expect(comparison.value.baseCheckpointId).toBe(checkpointId)
        expect(comparison.value.targetCheckpointId).toBe(secondCheckpointId)
      }

      const resume = await page.evaluate(
        (id) => window.savepoint.checkpoints.resume(id),
        checkpointId
      )
      expect(resume.ok).toBe(true)
      if (resume.ok) expect(resume.value.checkpointId).toBe(checkpointId)

      const repositorySettings = await page.evaluate(
        (id) =>
          window.savepoint.repositories.update({
            id,
            autoCheckpointEnabled: true,
            autoCheckpointIntervalMinutes: 20
          }),
        created.repositoryId
      )
      expect(repositorySettings.ok).toBe(true)
      if (repositorySettings.ok) {
        expect(repositorySettings.value.autoCheckpointEnabled).toBe(true)
        expect(repositorySettings.value.autoCheckpointIntervalMinutes).toBe(20)
      }
      const appSettings = await page.evaluate(() =>
        window.savepoint.settings.update({ theme: 'light' })
      )
      expect(appSettings.ok).toBe(true)
      if (appSettings.ok) expect(appSettings.value.theme).toBe('light')

      const markdownPath = join(root, 'runtime-checkpoint.md')
      const jsonPath = join(root, 'runtime-checkpoint.json')
      await application.evaluate(
        ({ dialog }, paths) => {
          Object.defineProperty(dialog, 'showSaveDialog', {
            configurable: true,
            value: (_window: unknown, options: { defaultPath?: string }) =>
              Promise.resolve({
                canceled: false,
                filePath: options.defaultPath?.endsWith('.json') ? paths.json : paths.markdown
              })
          })
        },
        { markdown: markdownPath, json: jsonPath }
      )
      const writtenExports = await page.evaluate(
        async (id) =>
          Promise.all([
            window.savepoint.checkpoints.export(id, 'markdown'),
            window.savepoint.checkpoints.export(id, 'json')
          ]),
        checkpointId
      )
      expect(writtenExports.every((result) => result.ok && !result.value.canceled)).toBe(true)
      const markdown = await readFile(markdownPath, 'utf8')
      const json = await readFile(jsonPath, 'utf8')
      expect(markdown).toContain('Runtime checkpoint updated')
      expect(json).toContain('Runtime checkpoint updated')
      expect(markdown).not.toContain('runtime-secret-value')
      expect(json).not.toContain('runtime-secret-value')

      const invalidExternal = await page.evaluate(() =>
        window.savepoint.system.openExternal('http://example.com/not-allowed')
      )
      expect(invalidExternal.ok).toBe(false)

      await application.evaluate(({ dialog, shell }) => {
        const state = globalThis as typeof globalThis & {
          savepointExternalPromptCount?: number
          savepointExternalUrl?: string
        }
        state.savepointExternalPromptCount = 0
        Object.defineProperty(dialog, 'showMessageBox', {
          configurable: true,
          value: () => {
            state.savepointExternalPromptCount = (state.savepointExternalPromptCount ?? 0) + 1
            return Promise.resolve({ response: 1, checkboxChecked: false })
          }
        })
        Object.defineProperty(shell, 'openExternal', {
          configurable: true,
          value: (url: string) => {
            state.savepointExternalUrl = url
            return Promise.resolve()
          }
        })
      })
      const validExternal = await page.evaluate(() =>
        window.savepoint.system.openExternal('https://example.com/runtime')
      )
      expect(validExternal.ok).toBe(true)
      const externalState = await application.evaluate(() => {
        const state = globalThis as typeof globalThis & {
          savepointExternalPromptCount?: number
          savepointExternalUrl?: string
        }
        return {
          promptCount: state.savepointExternalPromptCount,
          url: state.savepointExternalUrl
        }
      })
      expect(externalState).toEqual({
        promptCount: 1,
        url: 'https://example.com/runtime'
      })

      await application.evaluate(({ dialog }) => {
        Object.defineProperty(dialog, 'showSaveDialog', {
          configurable: true,
          value: () => Promise.resolve({ canceled: true })
        })
      })
      const canceledExport = await page.evaluate(
        (id) => window.savepoint.checkpoints.export(id, 'json'),
        checkpointId
      )
      expect(canceledExport.ok).toBe(true)
      if (canceledExport.ok) expect(canceledExport.value.canceled).toBe(true)

      await page.evaluate(() => {
        const state = window as Window & { savepointNotification?: Promise<boolean> }
        state.savepointNotification = new Promise((resolveNotification) => {
          const dispose = window.savepoint.events.onCheckpointsChanged(() => {
            dispose()
            resolveNotification(true)
          })
        })
      })
      await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('checkpoints:changed')
      })
      const notificationReceived = await page.evaluate(() => {
        const state = window as Window & { savepointNotification?: Promise<boolean> }
        return state.savepointNotification
      })
      expect(notificationReceived).toBe(true)

      await application.close()
      application = null

      application = await launch()
      const reloadedPage = await application.firstWindow()
      await reloadedPage.waitForLoadState('domcontentloaded')
      const result = await reloadedPage.evaluate(() =>
        window.savepoint.checkpoints.list({ search: 'Runtime checkpoint updated' })
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0]?.id).toBe(checkpointId)
        expect(result.value[0]?.git.files.map(({ path }) => path)).toEqual(['README.md'])
      }
      const allCheckpoints = await reloadedPage.evaluate(() => window.savepoint.checkpoints.list())
      expect(allCheckpoints.ok).toBe(true)
      if (allCheckpoints.ok) {
        expect(allCheckpoints.value.map(({ id }) => id)).toEqual(
          expect.arrayContaining([checkpointId, secondCheckpointId])
        )
      }
      const persistedSettings = await reloadedPage.evaluate(() => window.savepoint.settings.get())
      expect(persistedSettings.ok).toBe(true)
      if (persistedSettings.ok) expect(persistedSettings.value.theme).toBe('light')
    } finally {
      await application?.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
