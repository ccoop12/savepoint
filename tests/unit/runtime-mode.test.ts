import { describe, expect, it } from 'vitest'

import { resolveRendererRuntimeMode } from '../../src/renderer/src/runtime-mode'

describe('renderer runtime mode', () => {
  it('uses fictional data only when the browser demo is explicitly enabled', () => {
    expect(resolveRendererRuntimeMode(true, false)).toBe('demo')
    expect(resolveRendererRuntimeMode(true, true)).toBe('demo')
  })

  it('uses the native bridge in the desktop build', () => {
    expect(resolveRendererRuntimeMode(false, true)).toBe('native')
  })

  it('fails closed when the desktop bridge is missing', () => {
    expect(resolveRendererRuntimeMode(false, false)).toBe('initialization-error')
  })
})
