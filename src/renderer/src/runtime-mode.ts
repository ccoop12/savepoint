export type RendererRuntimeMode = 'native' | 'demo' | 'initialization-error'

export function resolveRendererRuntimeMode(
  demoEnabled: boolean,
  nativeBridgeAvailable: boolean
): RendererRuntimeMode {
  if (demoEnabled) return 'demo'
  return nativeBridgeAvailable ? 'native' : 'initialization-error'
}
