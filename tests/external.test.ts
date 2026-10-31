import { describe, expect, it } from 'vitest'

import { isExternalUrlAllowed, isSafeLinkTarget } from '../src/platform/external.js'

describe('external URL policy', () => {
  it('allows only http, https and mailto links', () => {
    expect(isExternalUrlAllowed('https://example.com/a?b=1')).toBe(true)
    expect(isExternalUrlAllowed('http://localhost:1420')).toBe(true)
    expect(isExternalUrlAllowed('HTTPS://EXAMPLE.COM')).toBe(true)
    expect(isExternalUrlAllowed('mailto:hello@example.com')).toBe(true)
  })

  it('allows relative Markdown links and anchors while blocking active schemes', () => {
    for (const target of [
      './notes/other.md',
      '../readme.md',
      '/docs/index.md',
      '#heading',
      'https://example.com',
      'mailto:hello@example.com',
    ]) {
      expect(isSafeLinkTarget(target), target).toBe(true)
    }
    for (const target of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script></script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      'ftp://example.com/file',
    ]) {
      expect(isSafeLinkTarget(target), target).toBe(false)
    }
  })

  it('rejects script, local file, data and relative links', () => {
    for (const url of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'file:///C:/Windows/System32/calc.exe',
      'data:text/html,<script>alert(1)</script>',
      './relative.md',
      '/absolute.md',
      'notes.md',
      '',
    ]) {
      expect(isExternalUrlAllowed(url), url).toBe(false)
    }
  })
})
