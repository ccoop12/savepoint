import { isAbsolute, relative, resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
    unhandle: vi.fn()
  }
}))

import { resolveRendererAssetPath } from '../../src/main/protocol'

describe('custom renderer protocol', () => {
  it('serves only allow-listed assets under the renderer root', () => {
    const root = resolve('C:/savepoint-renderer-root')
    expect(resolveRendererAssetPath(root, 'savepoint://app/index.html')).toBe(
      resolve(root, 'index.html')
    )
    expect(resolveRendererAssetPath(root, 'savepoint://app/assets/app.js')).toBe(
      resolve(root, 'assets/app.js')
    )
    expect(resolveRendererAssetPath(root, 'savepoint://app/source.map')).toBeNull()
    expect(resolveRendererAssetPath(root, 'savepoint://app/data.json')).toBeNull()
  })

  it.each([
    'file:///etc/passwd.js',
    'https://app/index.js',
    'savepoint://evil/index.js',
    'savepoint://user@app/index.js',
    'savepoint://app:123/index.js',
    'savepoint://app/..%2foutside.js',
    'savepoint://app/%2e%2e%5coutside.js',
    'savepoint://app/%00outside.js',
    'savepoint://app/C:/Windows/System32/outside.js'
  ])('rejects unsafe route %s', (url) => {
    expect(resolveRendererAssetPath(resolve('C:/savepoint-renderer-root'), url)).toBeNull()
  })

  it('keeps normalized and double-encoded paths lexically contained', () => {
    const root = resolve('C:/savepoint-renderer-root')
    for (const url of [
      'savepoint://app/%2e%2e/normalized.js',
      'savepoint://app/%252e%252e%252fencoded.js'
    ]) {
      const candidate = resolveRendererAssetPath(root, url)
      expect(candidate).not.toBeNull()
      const child = relative(root, candidate!)
      expect(child.startsWith('..')).toBe(false)
      expect(isAbsolute(child)).toBe(false)
    }
  })
})
