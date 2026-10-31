import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function json<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')) as T
}

const packageJson = json<{ version: string; dependencies: Record<string, string> }>('package.json')
const tauri = json<{
  version: string
  app: {
    windows: Array<{ decorations?: boolean }>
    security: { csp: string; devCsp: string; freezePrototype?: boolean }
  }
  bundle: { active: boolean; targets: string; publisher?: string; shortDescription?: string }
}>('src-tauri/tauri.conf.json')
const windowsConfig = json<{ app: { windows: Array<{ decorations?: boolean }> } }>(
  'src-tauri/tauri.windows.conf.json',
)
const macConfig = json<{
  app: { windows: Array<{ titleBarStyle?: string; hiddenTitle?: boolean; decorations?: boolean }> }
}>('src-tauri/tauri.macos.conf.json')
const capabilities = json<{ permissions: string[] }>('src-tauri/capabilities/default.json')

describe('release security configuration', () => {
  it('keeps package and bundle versions aligned', () => {
    expect(packageJson.version).toBe(tauri.version)
  })

  it('ships a strict production CSP and a separate dev CSP', () => {
    const csp = tauri.app.security.csp
    expect(csp).not.toBeNull()
    const directives = new Map(
      csp.split(';').map(directive => {
        const [name, ...values] = directive.trim().split(/\s+/)
        return [name, values.join(' ')] as const
      }),
    )
    expect(directives.get('default-src')).toBe("'self'")
    expect(directives.get('script-src')).toBe("'self'")
    expect(directives.get('connect-src')).toContain('ipc:')
    expect(directives.get('connect-src')).toContain('http://ipc.localhost')
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(tauri.app.security.devCsp).toContain('localhost:1420')
    expect(tauri.app.security.freezePrototype).toBe(true)
  })

  it('grants only the window chrome and event permissions the UI needs', () => {
    expect(capabilities.permissions).not.toContain('core:default')
    expect(capabilities.permissions).not.toContain('dialog:default')
    expect(capabilities.permissions.some(permission => permission.startsWith('dialog:'))).toBe(
      false,
    )
    expect(new Set(capabilities.permissions)).toEqual(
      new Set([
        'core:event:allow-listen',
        'core:event:allow-unlisten',
        'core:window:allow-minimize',
        'core:window:allow-toggle-maximize',
        'core:window:allow-is-maximized',
        'core:window:allow-close',
        'core:window:allow-start-dragging',
        'core:window:allow-internal-toggle-maximize',
      ]),
    )
  })

  it('uses a custom Windows title bar, a macOS overlay and native Linux chrome', () => {
    expect(tauri.app.windows[0]?.decorations).toBe(true)
    expect(windowsConfig.app.windows[0]?.decorations).toBe(false)
    expect(macConfig.app.windows[0]?.decorations).toBe(true)
    expect(macConfig.app.windows[0]?.titleBarStyle).toBe('Overlay')
    expect(macConfig.app.windows[0]?.hiddenTitle).toBe(true)
  })

  it('ships publisher metadata for desktop bundles', () => {
    expect(tauri.bundle.active).toBe(true)
    expect(tauri.bundle.targets).toBe('all')
    expect(tauri.bundle.publisher).toBe('Y Note')
    expect(tauri.bundle.shortDescription).toContain('Local-first')
  })

  it('enforces path scope in every document, workspace, watcher and Git command', () => {
    const files = [
      'src-tauri/src/document.rs',
      'src-tauri/src/workspace.rs',
      'src-tauri/src/watch.rs',
      'src-tauri/src/git.rs',
      'src-tauri/src/scope.rs',
    ]
    const source = files
      .map(file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))
      .join('\n')
    expect(source.match(/scope\.require\(/g)?.length ?? 0).toBeGreaterThanOrEqual(6)
    expect(source).toContain('not-authorized')
  })

  it('validates the external-link scheme in Rust and JS', () => {
    const rust = readFileSync(new URL('../src-tauri/src/external.rs', import.meta.url), 'utf8')
    expect(rust).toContain('"http" | "https"')
    expect(rust).toContain('"mailto"')
    expect(rust).toContain('Only http, https and mailto')
  })
})
