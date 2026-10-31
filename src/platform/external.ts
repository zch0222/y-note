const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** Only explicit external protocols are opened; relative and script URLs stay inside the app. */
/** Link editing also permits relative paths and #anchors, but never active schemes. */
export function isSafeLinkTarget(target: string): boolean {
  const trimmed = target.trim()
  if (!trimmed) {
    return false
  }
  if (/^(javascript|data|file|vbscript):/i.test(trimmed)) {
    return false
  }
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return true
  }
  return isExternalUrlAllowed(trimmed)
}

export function isExternalUrlAllowed(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return false
  }
  if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.hostname) {
    return false
  }
  return true
}
