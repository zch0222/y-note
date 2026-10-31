import type { Platform } from '../state/store.js'

export function modKey(platform: Platform): string {
  return platform === 'macos' ? '⌘' : 'Ctrl'
}

export function shortcutText(platform: Platform, keys: string): string {
  return keys
    .split('+')
    .map(key => (key === 'Mod' ? modKey(platform) : key))
    .join(' + ')
}

export function shortcutAria(platform: Platform, keys: string): string {
  return keys
    .split('+')
    .map(key => (key === 'Mod' ? (platform === 'macos' ? 'Meta' : 'Control') : key))
    .join('+')
}
