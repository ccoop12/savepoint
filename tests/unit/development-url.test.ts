import { describe, expect, it } from 'vitest'

import { trustedDevelopmentRendererUrl } from '../../src/main/development-url'

describe('trustedDevelopmentRendererUrl', () => {
  it('accepts credential-free HTTP(S) loopback development URLs', () => {
    expect(trustedDevelopmentRendererUrl('http://localhost:5173/', false)).toBe(
      'http://localhost:5173/'
    )
    expect(trustedDevelopmentRendererUrl('https://127.12.34.56:4173/app', false)).toBe(
      'https://127.12.34.56:4173/app'
    )
    expect(trustedDevelopmentRendererUrl('http://[::1]:5173/', false)).toBe('http://[::1]:5173/')
  })

  it('rejects remote, credentialed, malformed, and packaged URLs', () => {
    expect(trustedDevelopmentRendererUrl('https://attacker.invalid/', false)).toBeUndefined()
    expect(
      trustedDevelopmentRendererUrl('http://user:password@localhost:5173/', false)
    ).toBeUndefined()
    expect(trustedDevelopmentRendererUrl('file:///tmp/index.html', false)).toBeUndefined()
    expect(trustedDevelopmentRendererUrl('not a URL', false)).toBeUndefined()
    expect(trustedDevelopmentRendererUrl('http://localhost:5173/', true)).toBeUndefined()
  })
})
