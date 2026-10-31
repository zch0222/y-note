import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/styles/design.css', import.meta.url), 'utf8')
const appCss = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8')

function block(selector: string): Record<string, string> {
  const match = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`))
  if (!match) {
    throw new Error(`Missing CSS block ${selector}`)
  }
  const tokens: Record<string, string> = {}
  for (const [, name, value] of match[1]!.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    tokens[name!] = value!
  }
  return tokens
}

const light = block(':root')
const dark = block('\\[data-theme="dark"\\]')

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map(value => parseInt(value, 16) / 255)
    .map(value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0]! + 0.05) / (values[1]! + 0.05)
}

const textPairs = [
  ['text', 'paper'],
  ['text', 'panel'],
  ['text-soft', 'paper'],
  ['text-soft', 'panel'],
  ['muted', 'paper'],
  ['muted', 'sidebar'],
  ['muted', 'panel'],
  ['muted', 'workbench'],
  ['faint', 'paper'],
  ['faint', 'sidebar'],
  ['faint', 'panel'],
  ['faint', 'workbench'],
  ['accent', 'paper'],
  ['accent', 'accent-soft'],
  ['green', 'paper'],
  ['green', 'green-soft'],
  ['amber', 'paper'],
  ['amber', 'amber-soft'],
  ['red', 'paper'],
  ['red', 'red-soft'],
  ['on-accent', 'accent'],
  ['on-green', 'green'],
  ['code-text', 'code-bg'],
] as const

describe('WCAG AA design tokens', () => {
  for (const [themeName, tokens] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it(`${themeName} theme body and secondary text meet 4.5:1`, () => {
      const failures: string[] = []
      for (const [foreground, background] of textPairs) {
        const ratio = contrast(tokens[foreground]!, tokens[background]!)
        if (ratio < 4.5) {
          failures.push(`${foreground} on ${background}: ${ratio.toFixed(2)}`)
        }
      }
      expect(failures).toEqual([])
    })

    it(`${themeName} theme control boundaries meet 3:1`, () => {
      for (const background of ['paper', 'sidebar', 'panel', 'workbench']) {
        expect(
          contrast(tokens['control-border']!, tokens[background]!),
          `control-border on ${background}`,
        ).toBeGreaterThanOrEqual(3)
      }
    })
  }

  it('focus, reduced motion, zoom and print affordances are present', () => {
    expect(css).toContain(':focus-visible')
    expect(css).toContain('prefers-reduced-motion')
    expect(appCss).toContain('[data-motion="reduced"]')
    expect(appCss).toContain('@media print')
    expect(appCss).toContain('.window > :not(.print-root)')
    expect(appCss).toContain('content-visibility: visible !important')
    expect(appCss).toContain('@media (max-width: 720px)')
    expect(appCss).toContain('@media (max-width: 560px)')
    expect(appCss).toMatch(/\.workspace > \.editor-pane\s*{\s*grid-column: 3;/)
  })
})
