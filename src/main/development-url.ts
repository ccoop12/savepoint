function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost' || normalized === '[::1]') return true
  const octets = normalized.split('.')
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  )
}

/** Accepts the Electron/Vite renderer only when it is a credential-free loopback URL. */
export function trustedDevelopmentRendererUrl(
  rawUrl: string | undefined,
  isPackaged: boolean
): string | undefined {
  if (isPackaged || !rawUrl) return undefined
  try {
    const url = new URL(rawUrl)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      !isLoopbackHostname(url.hostname)
    ) {
      return undefined
    }
    return url.toString()
  } catch {
    return undefined
  }
}
