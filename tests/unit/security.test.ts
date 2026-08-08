import { describe, expect, it } from 'vitest'
import {
  REDACTION_MARKER,
  containsLikelySecret,
  filterSecretFiles,
  isSecretPath,
  matchesExclusionPattern,
  redactSecrets,
  redactSensitiveValues,
  sanitizeCheckpointContext
} from '../../src/shared'
import { makeContext, makeGitFile } from './fixtures'

describe('secret path filtering', () => {
  it.each([
    '.env',
    '.env.local',
    '.envrc',
    '.git-credentials',
    '.vault-token',
    '.pgpass',
    'postgres/pgpass.conf',
    'config/.env.production',
    '.direnv/allow',
    '.docker/config.json',
    'profiles/work/.docker/config.json',
    'terraform.tfstate',
    'infra/terraform.tfstate.backup',
    '.ssh/id_ed25519',
    'keys/server.pem',
    'certs/site.p12',
    '.aws/credentials',
    'config/secrets.yml',
    'service-account.json'
  ])('excludes %s', (path) => {
    expect(isSecretPath(path)).toBe(true)
  })

  it('keeps ordinary source metadata and honors custom and ignored paths', () => {
    expect(isSecretPath('src/environment.ts')).toBe(false)
    expect(isSecretPath('.docker/README.md')).toBe(false)
    expect(isSecretPath('src/config.json')).toBe(false)
    expect(isSecretPath('generated/output.ts', { exclusionPatterns: ['generated/**'] })).toBe(true)
    expect(isSecretPath('ordinary.txt', { gitIgnored: true })).toBe(true)
    expect(matchesExclusionPattern('packages/api/private/a.json', '**/private/**')).toBe(true)
    expect(matchesExclusionPattern('private/a.json', '**/private/**')).toBe(true)
  })

  it('removes secret-like Git file metadata', () => {
    const files = [
      makeGitFile(),
      makeGitFile({ path: '.env.local' }),
      makeGitFile({ path: 'tmp/debug.log' }),
      makeGitFile({ path: 'ignored.txt', status: 'ignored' })
    ]
    expect(
      filterSecretFiles(files, { exclusionPatterns: ['tmp/**'] }).map((file) => file.path)
    ).toEqual(['src/index.ts'])
  })
})

describe('secret value redaction', () => {
  it('redacts assignments, authorization values, common tokens, JWTs, and URL credentials', () => {
    const source = [
      'password=hunter2',
      'Authorization: Bearer abcdefghijklmnop',
      'ghp_abcdefghijklmnopqrstuvwxyz123456',
      'AKIAIOSFODNN7EXAMPLE',
      'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature123',
      'https://alice:swordfish@example.test/repo'
    ].join('\n')
    const redacted = redactSecrets(source)
    expect(redacted).not.toContain('hunter2')
    expect(redacted).not.toContain('abcdefghijklmnop')
    expect(redacted).not.toContain('swordfish')
    expect(redacted.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(8)
    expect(containsLikelySecret(source)).toBe(true)
    expect(containsLikelySecret('ordinary development note')).toBe(false)
  })

  it('redacts private-key blocks', () => {
    const key = '-----BEGIN PRIVATE KEY-----\nvery-sensitive-material\n-----END PRIVATE KEY-----'
    expect(redactSecrets(key)).toBe(REDACTION_MARKER)
  })

  it('redacts values beneath sensitive object keys recursively', () => {
    const result = redactSensitiveValues({ profile: { apiKey: 'plain-value' }, notes: ['safe'] })
    expect(result).toEqual({ profile: { apiKey: REDACTION_MARKER }, notes: ['safe'] })
  })

  it('sanitizes every user-authored checkpoint field before storage', () => {
    const context = sanitizeCheckpointContext(
      makeContext({
        notes: 'password=do-not-store',
        commands: ['curl -H "Authorization: Bearer secret-token"']
      })
    )
    expect(context.notes).toBe(`password=${REDACTION_MARKER}`)
    expect(context.commands[0]).toContain(REDACTION_MARKER)
    expect(context.commands[0]).not.toContain('secret-token')
  })

  it('redacts prefixed environment-variable secrets and preserves valid secret-bearing URLs', () => {
    const context = sanitizeCheckpointContext(
      makeContext({
        notes: 'OPENAI_API_KEY="value with spaces"',
        links: ['https://alice:swordfish@example.test/path?api_token=secret-value']
      })
    )
    expect(context.notes).toBe('OPENAI_API_KEY="[REDACTED]"')
    expect(context.links[0]).not.toContain('alice')
    expect(context.links[0]).not.toContain('swordfish')
    expect(context.links[0]).not.toContain('secret-value')
    expect(() => new URL(context.links[0])).not.toThrow()
  })
})
