import { describe, expect, it } from 'vitest'
import {
  createCheckpointJsonExport,
  exportCheckpointJSON,
  exportCheckpointJson,
  exportCheckpointMarkdown
} from '../../src/shared'
import { makeCheckpoint, makeContext } from './fixtures'

describe('checkpoint export', () => {
  it('produces a readable Markdown briefing with Git metadata but no source contents', () => {
    const markdown = exportCheckpointMarkdown(makeCheckpoint(), {
      repositoryName: 'fictional-repository'
    })
    expect(markdown).toContain('# Capture Git context')
    expect(markdown).toContain('## Goal')
    expect(markdown).toContain('## Work completed')
    expect(markdown).toContain('| src/index.ts | modified | no | 4 | 1 |')
    expect(markdown).toContain('`0123456` Add checkpoint capture')
    expect(markdown).toContain('fictional-repository')
    expect(markdown).not.toContain('diff --git')
    expect(markdown).not.toContain('sourceContents')
  })

  it('escapes active HTML and handles commands containing Markdown fences', () => {
    const checkpoint = makeCheckpoint({
      context: makeContext({
        notes: '<script>alert(1)</script>',
        commands: ['node -e "console.log(`ok`)"']
      })
    })
    const markdown = exportCheckpointMarkdown(checkpoint)
    expect(markdown).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(markdown).toContain('node -e "console.log(`ok`)"')
    expect(markdown).toContain('```')
  })

  it('keeps untrusted text from creating Markdown links, images, or table rows', () => {
    const base = makeCheckpoint()
    const checkpoint = makeCheckpoint({
      context: makeContext({
        title: 'Safe title\n![pixel](https://attacker.invalid/title)',
        goal: '[click](https://attacker.invalid/goal) or https://attacker.invalid/bare',
        notes: '<https://attacker.invalid/autolink>',
        tags: ['plain', '`break` ![pixel](https://attacker.invalid/tag)'],
        links: ['https://example.test/intentional']
      }),
      git: {
        ...base.git,
        files: [
          {
            ...base.git.files[0],
            path: 'src/file.md\n| injected | ![pixel](https://attacker.invalid/file) |'
          }
        ]
      }
    })

    const markdown = exportCheckpointMarkdown(checkpoint, {
      repositoryName: 'demo\n![pixel](https://attacker.invalid/repository)'
    })

    expect(markdown).toContain('# Safe title \\!\\[pixel\\](https\\://attacker.invalid/title)')
    expect(markdown).toContain(
      '\\[click\\](https\\://attacker.invalid/goal) or https\\://attacker.invalid/bare'
    )
    expect(markdown).toContain('&lt;https\\://attacker.invalid/autolink&gt;')
    expect(markdown).toContain(
      '| src/file.md \\| injected \\| \\!\\[pixel\\](https\\://attacker.invalid/file) \\| |'
    )
    expect(markdown).toContain('`` `break` ![pixel](https://attacker.invalid/tag) ``')
    expect(markdown).toContain('- <https://example.test/intentional>')
    expect(markdown).not.toContain('![pixel](https://attacker.invalid/title)')
    expect(markdown).not.toContain('[click](https://attacker.invalid/goal)')
  })

  it('redacts secret-like values from Markdown output', () => {
    const checkpoint = makeCheckpoint({
      context: makeContext({ notes: 'password=never-export-this' }),
      git: {
        ...makeCheckpoint().git,
        files: [
          ...makeCheckpoint().git.files,
          { ...makeCheckpoint().git.files[0], path: '.env.local' }
        ]
      }
    })
    const markdown = exportCheckpointMarkdown(checkpoint)
    expect(markdown).toContain('password=\\[REDACTED\\]')
    expect(markdown).not.toContain('never-export-this')
    expect(markdown).not.toContain('.env.local')
  })

  it('redacts secret-like values from repository names in every export format', () => {
    const repositoryName = 'client_secret=repository-name-secret'
    const markdown = exportCheckpointMarkdown(makeCheckpoint(), { repositoryName })
    const json = createCheckpointJsonExport(makeCheckpoint(), { repositoryName })

    expect(markdown).toContain('client_secret=\\[REDACTED\\]')
    expect(markdown).not.toContain('repository-name-secret')
    expect(json.repositoryName).toBe('client_secret=[REDACTED]')
    expect(JSON.stringify(json)).not.toContain('repository-name-secret')
  })

  it('produces versioned, valid, deterministic-shape JSON with redaction', () => {
    const checkpoint = makeCheckpoint({
      context: makeContext({ notes: 'api_token=very-secret-value' })
    })
    const text = exportCheckpointJson(checkpoint, {
      repositoryName: 'demo',
      exportedAt: '2026-02-03T04:05:06.000Z'
    })
    const parsed = JSON.parse(text) as ReturnType<typeof createCheckpointJsonExport>
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.exportedAt).toBe('2026-02-03T04:05:06.000Z')
    expect(parsed.repositoryName).toBe('demo')
    expect(parsed.checkpoint.context.notes).toBe('api_token=[REDACTED]')
    expect(text).not.toContain('very-secret-value')
    expect(exportCheckpointJSON).toBe(exportCheckpointJson)
  })
})
