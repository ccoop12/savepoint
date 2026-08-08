import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { simpleGit } from 'simple-git'
import { afterEach, describe, expect, it } from 'vitest'

import {
  CaptureLimitError,
  GitCaptureService,
  InvalidRepositoryError
} from '../../src/main/services/git-capture'

const temporaryDirectories: string[] = []

async function createRepository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'savepoint-git-'))
  temporaryDirectories.push(directory)
  const git = simpleGit(directory)
  await git.init()
  await git.addConfig('user.name', 'SavePoint Integration Test', false, 'local')
  await git.addConfig('user.email', 'savepoint@example.invalid', false, 'local')
  await mkdir(join(directory, 'src'), { recursive: true })
  await writeFile(join(directory, 'README.md'), '# Fixture\n')
  await writeFile(join(directory, '.gitignore'), '.env*\n*.pem\nprivate/\n')
  await writeFile(join(directory, 'credentials.json'), '{"fixture":true}\n')
  await git.add(['README.md', '.gitignore', 'credentials.json'])
  await git.commit('test: establish safe fixture')
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('GitCaptureService', () => {
  it('resolves the repository root and rejects non-repositories', async () => {
    const repositoryPath = await createRepository()
    const service = new GitCaptureService()

    expect(await service.resolveRepository(join(repositoryPath, 'src'))).toEqual({
      path: repositoryPath,
      name: repositoryPath.split(/[\\/]/).at(-1)
    })

    const ordinaryDirectory = await mkdtemp(join(tmpdir(), 'savepoint-non-git-'))
    temporaryDirectories.push(ordinaryDirectory)
    await expect(service.resolveRepository(ordinaryDirectory)).rejects.toBeInstanceOf(
      InvalidRepositoryError
    )
  })

  it('captures Git metadata and excludes ignored, secret-like, and configured paths', async () => {
    const repositoryPath = await createRepository()
    const git = simpleGit(repositoryPath)
    await mkdir(join(repositoryPath, 'generated'), { recursive: true })
    await writeFile(join(repositoryPath, 'README.md'), '# Fixture\n\nWork in progress.\n')
    await writeFile(join(repositoryPath, 'credentials.json'), '{"password":"fixture"}\n')
    await writeFile(join(repositoryPath, 'src', 'new.ts'), 'export const ready = true\n')
    await writeFile(join(repositoryPath, '.env.local'), 'TOKEN=fixture\n')
    await writeFile(join(repositoryPath, 'server.pem'), 'fixture certificate\n')
    await writeFile(join(repositoryPath, 'generated', 'cache.js'), 'generated\n')
    await writeFile(join(repositoryPath, 'local-only.cache'), 'ignored by info/exclude\n')
    await writeFile(join(repositoryPath, '.git', 'info', 'exclude'), 'local-only.cache\n')
    await git.add('src/new.ts')
    const fsMonitorHook = join(repositoryPath, '.git', 'malicious-fsmonitor.sh')
    const fsMonitorMarker = join(repositoryPath, '.git', 'fsmonitor-invoked')
    await writeFile(
      fsMonitorHook,
      '#!/bin/sh\nprintf invoked > .git/fsmonitor-invoked\nprintf "\\0"\n'
    )
    await chmod(fsMonitorHook, 0o755)
    await simpleGit({
      baseDir: repositoryPath,
      unsafe: { allowUnsafeFsMonitor: true }
    }).addConfig('core.fsmonitor', fsMonitorHook.replaceAll('\\', '/'), false, 'local')

    const service = new GitCaptureService()
    const captured = await service.capture(repositoryPath, {
      exclusionPatterns: ['generated/**'],
      recentCommitLimit: 3
    })
    const paths = captured.files.map(({ path }) => path)

    expect(paths).toContain('README.md')
    expect(paths).toContain('src/new.ts')
    expect(paths).not.toContain('credentials.json')
    expect(paths).not.toContain('.env.local')
    expect(paths).not.toContain('server.pem')
    expect(paths).not.toContain('generated/cache.js')
    expect(paths).not.toContain('local-only.cache')
    expect(captured.counts).toMatchObject({ staged: 1, modified: 1, added: 1 })
    expect(captured.diffStats.filesChanged).toBe(2)
    expect(captured.commitHash).toMatch(/^[0-9a-f]{40}$/)
    expect(captured.shortCommitHash).toBe(captured.commitHash.slice(0, 7))
    expect(captured.recentCommits[0]).toMatchObject({
      subject: 'test: establish safe fixture',
      authorName: 'SavePoint Integration Test'
    })
    expect(existsSync(fsMonitorMarker)).toBe(false)
  })

  it('excludes tracked paths covered by Git ignore rules, including Unicode names', async () => {
    const repositoryPath = await createRepository()
    const git = simpleGit(repositoryPath)
    const ignoredPaths = ['tracked-local-settings.json', 'café-local-notes.txt']
    for (const path of ignoredPaths) await writeFile(join(repositoryPath, path), 'baseline\n')
    await git.add(ignoredPaths)
    await git.commit('test: add files before local ignore rules')
    await writeFile(join(repositoryPath, '.gitignore'), `${ignoredPaths.join('\n')}\n`)
    await git.add('.gitignore')
    await git.commit('test: ignore already tracked local files')
    for (const path of ignoredPaths) await writeFile(join(repositoryPath, path), 'changed\n')

    const captured = await new GitCaptureService().capture(repositoryPath)

    for (const path of ignoredPaths) {
      expect(captured.files.map(({ path: capturedPath }) => capturedPath)).not.toContain(path)
    }
  })

  it('does not inherit global ignore configuration', async () => {
    const repositoryPath = await createRepository()
    const git = simpleGit(repositoryPath)
    await writeFile(join(repositoryPath, 'app.ts'), 'export const version = 1\n')
    await git.add('app.ts')
    await git.commit('test: add globally ignored fixture')
    await writeFile(join(repositoryPath, 'app.ts'), 'export const version = 2\n')

    const globalHome = await mkdtemp(join(tmpdir(), 'savepoint-global-config-'))
    temporaryDirectories.push(globalHome)
    const globalExcludes = join(globalHome, 'global-excludes')
    await writeFile(globalExcludes, 'app.ts\n')
    await writeFile(
      join(globalHome, '.gitconfig'),
      `[core]\n\texcludesFile = ${globalExcludes.replaceAll('\\', '/')}\n`
    )

    const previousHome = process.env.HOME
    const previousUserProfile = process.env.USERPROFILE
    process.env.HOME = globalHome
    process.env.USERPROFILE = globalHome
    try {
      const captured = await new GitCaptureService().capture(repositoryPath)
      expect(captured.files.map(({ path }) => path)).toContain('app.ts')
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      if (previousUserProfile === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = previousUserProfile
    }
  })

  it('supports newly initialized repositories without a first commit', async () => {
    const repositoryPath = await mkdtemp(join(tmpdir(), 'savepoint-empty-git-'))
    temporaryDirectories.push(repositoryPath)
    await simpleGit(repositoryPath).init()

    const captured = await new GitCaptureService().capture(repositoryPath)
    expect(captured.commitHash).toBe('0000000000000000000000000000000000000000')
    expect(captured.shortCommitHash).toBe('0000000')
    expect(captured.recentCommits).toEqual([])
  })

  it('never executes repository-configured clean filters while inspecting the worktree', async () => {
    const repositoryPath = await createRepository()
    const git = simpleGit(repositoryPath)
    const trackedPath = join(repositoryPath, 'filtered.txt')
    await writeFile(join(repositoryPath, '.gitattributes'), '*.txt filter=adversarial\n')
    await writeFile(trackedPath, 'committed\n')
    await git.add(['.gitattributes', 'filtered.txt'])
    await git.commit('test: add filtered fixture')

    const filterMarker = join(repositoryPath, '.git', 'filter-invoked')
    const filterHook = join(repositoryPath, '.git', 'adversarial-clean.sh')
    await writeFile(
      filterHook,
      `#!/bin/sh\nprintf invoked > "${filterMarker.replaceAll('\\', '/')}"\ncat\n`
    )
    await chmod(filterHook, 0o755)
    const configGit = simpleGit({
      baseDir: repositoryPath,
      unsafe: { allowUnsafeFilter: true }
    })
    await configGit.addConfig(
      'filter.adversarial.clean',
      filterHook.replaceAll('\\', '/'),
      false,
      'local'
    )
    await configGit.addConfig('filter.adversarial.required', 'true', false, 'local')
    await writeFile(trackedPath, 'worktree change\n')

    const captured = await new GitCaptureService().capture(repositoryPath)

    expect(captured.files.map(({ path }) => path)).toContain('filtered.txt')
    expect(existsSync(filterMarker)).toBe(false)
  })

  it('preserves inert line-ending settings when determining whether a worktree is clean', async () => {
    const repositoryPath = await mkdtemp(join(tmpdir(), 'savepoint-crlf-git-'))
    temporaryDirectories.push(repositoryPath)
    const git = simpleGit(repositoryPath)
    await git.init()
    await git.addConfig('user.name', 'SavePoint Integration Test', false, 'local')
    await git.addConfig('user.email', 'savepoint@example.invalid', false, 'local')
    await git.addConfig('core.autocrlf', 'true', false, 'local')
    await writeFile(join(repositoryPath, 'windows.txt'), 'first\r\nsecond\r\n')
    await git.add('windows.txt')
    await git.commit('test: commit CRLF fixture')
    const future = new Date(Date.now() + 60_000)
    await utimes(join(repositoryPath, 'windows.txt'), future, future)

    expect(await git.diff(['--name-only'])).toBe('')
    const captured = await new GitCaptureService().capture(repositoryPath)
    expect(captured.files).toEqual([])
  })

  it('fails closed when Git cannot determine whether candidate paths are ignored', async () => {
    const repositoryPath = await createRepository()
    const git = simpleGit(repositoryPath)
    await git.addConfig('core.excludesFile', repositoryPath, false, 'local')
    await writeFile(join(repositoryPath, 'ordinary-untracked.txt'), 'candidate\n')

    const captured = await new GitCaptureService().capture(repositoryPath)
    expect(captured.files.map(({ path }) => path)).not.toContain('ordinary-untracked.txt')
  })

  it('supports split indexes without writing the original index during capture', async () => {
    const repositoryPath = await createRepository()
    const git = simpleGit(repositoryPath)
    await git.raw(['update-index', '--split-index'])
    await writeFile(join(repositoryPath, 'README.md'), '# Fixture\n\nSplit index change.\n')

    const captured = await new GitCaptureService().capture(repositoryPath)
    expect(captured.files.map(({ path }) => path)).toContain('README.md')
  })

  it('captures a staged rename alongside an ordinary modification', async () => {
    const repositoryPath = await createRepository()
    const git = simpleGit(repositoryPath)
    const originalPath = 'src/rename-source.ts'
    const renamedPath = 'src/rename-target.ts'
    await writeFile(join(repositoryPath, originalPath), 'export const renameFixture = true\n')
    await git.add(originalPath)
    await git.commit('test: add rename fixture')

    await git.mv(originalPath, renamedPath)
    await writeFile(join(repositoryPath, 'README.md'), '# Fixture\n\nModified beside rename.\n')

    const captured = await new GitCaptureService().capture(repositoryPath)

    expect(captured.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'README.md', status: 'modified' }),
        expect.objectContaining({
          path: renamedPath,
          previousPath: originalPath,
          status: 'renamed',
          staged: true
        })
      ])
    )
  })

  it('omits renames when either endpoint is secret-like or Git-ignored', async () => {
    const repositoryPath = await createRepository()
    const git = simpleGit(repositoryPath)
    const sources = {
      secretOld: 'auth-rename-source.json',
      secretNew: 'src/rename-to-secret.ts',
      ignoredOld: 'tracked-ignored-source.ts',
      ignoredNew: 'src/rename-to-ignored.ts'
    }
    for (const [index, path] of Object.values(sources).entries()) {
      await writeFile(
        join(repositoryPath, path),
        `${String.fromCharCode(65 + index).repeat(256)}\n`
      )
    }
    await git.add(Object.values(sources))
    await git.commit('test: add rename privacy fixtures')
    await writeFile(
      join(repositoryPath, '.gitignore'),
      '.env*\n*.pem\nprivate/\ntracked-ignored-source.ts\nignored-rename-target.ts\n'
    )
    await git.add('.gitignore')
    await git.commit('test: add rename privacy rules')

    const targets = {
      secretOld: 'src/renamed-from-secret.ts',
      secretNew: 'token-rename-target.json',
      ignoredOld: 'src/renamed-from-ignored.ts',
      ignoredNew: 'ignored-rename-target.ts'
    }
    for (const key of Object.keys(sources) as Array<keyof typeof sources>) {
      await git.mv(sources[key], targets[key])
    }

    const captured = await new GitCaptureService().capture(repositoryPath)
    const capturedPaths = captured.files.flatMap(({ path, previousPath }) =>
      previousPath ? [path, previousPath] : [path]
    )

    expect(capturedPaths).toEqual([])
  })

  it('captures linked worktrees while preserving their displayed branch', async () => {
    const repositoryPath = await createRepository()
    const parentDirectory = await mkdtemp(join(tmpdir(), 'savepoint-linked-parent-'))
    temporaryDirectories.push(parentDirectory)
    const linkedPath = join(parentDirectory, 'linked')
    await simpleGit(repositoryPath).raw([
      'worktree',
      'add',
      '-b',
      'savepoint-linked-test',
      linkedPath
    ])
    await writeFile(join(linkedPath, 'README.md'), '# Fixture\n\nLinked worktree change.\n')

    const captured = await new GitCaptureService().capture(linkedPath)
    expect(captured.branch).toBe('savepoint-linked-test')
    expect(captured.files.map(({ path }) => path)).toContain('README.md')
  })

  it('rejects oversized Git output instead of parsing a truncated snapshot', async () => {
    const repositoryPath = await createRepository()
    const git = simpleGit(repositoryPath)
    const messagePath = join(repositoryPath, '.git', 'oversized-message.txt')
    await writeFile(messagePath, `${'A'.repeat(16 * 1024 * 1024 + 1024)}\n`)
    await git.raw(['commit', '--allow-empty', '--quiet', '--file', messagePath])

    await expect(new GitCaptureService().capture(repositoryPath)).rejects.toBeInstanceOf(
      CaptureLimitError
    )
  })
})
