import { readFile, realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'

import { protocol } from 'electron'

export const SAVEPOINT_SCHEME = 'savepoint'
export const SAVEPOINT_APP_URL = `${SAVEPOINT_SCHEME}://app/index.html`
export const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2']
])

let schemeRegistered = false

/** Must run before Electron's ready event. */
export function registerSavePointScheme(): void {
  if (schemeRegistered) return
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SAVEPOINT_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        bypassCSP: false,
        allowServiceWorkers: false,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true,
        codeCache: true,
        allowExtensions: false
      }
    }
  ])
  schemeRegistered = true
}

function isContained(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return (
    child !== '' &&
    child !== '..' &&
    !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(child)
  )
}

/** Pure lexical routing check, with real-path containment checked before reads. */
export function resolveRendererAssetPath(rendererRoot: string, requestUrl: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (
    url.protocol !== `${SAVEPOINT_SCHEME}:` ||
    url.hostname !== 'app' ||
    url.port ||
    url.username ||
    url.password ||
    /%(?:00|2f|5c)/i.test(url.pathname)
  ) {
    return null
  }

  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  if (pathname.includes('\\') || pathname.includes('\0')) return null
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const extension = extname(requested).toLocaleLowerCase()
  if (!CONTENT_TYPES.has(extension)) return null
  const root = resolve(rendererRoot)
  const candidate = resolve(root, requested)
  return isContained(root, candidate) ? candidate : null
}

export async function installSavePointProtocol(rendererRoot: string): Promise<() => void> {
  const canonicalRoot = await realpath(rendererRoot)
  protocol.handle(SAVEPOINT_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }
      })
    }
    const candidate = resolveRendererAssetPath(canonicalRoot, request.url)
    if (!candidate) return new Response('Not found', { status: 404 })

    try {
      const canonicalCandidate = await realpath(candidate)
      if (!isContained(canonicalRoot, canonicalCandidate)) {
        return new Response('Not found', { status: 404 })
      }
      const contentType = CONTENT_TYPES.get(extname(canonicalCandidate).toLocaleLowerCase())
      if (!contentType) return new Response('Not found', { status: 404 })
      const bytes =
        request.method === 'HEAD' ? null : new Uint8Array(await readFile(canonicalCandidate))
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Security-Policy': PRODUCTION_CSP,
          'X-Content-Type-Options': 'nosniff',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cache-Control': contentType.startsWith('text/html')
            ? 'no-store'
            : 'public, max-age=31536000, immutable'
        }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  return () => protocol.unhandle(SAVEPOINT_SCHEME)
}
