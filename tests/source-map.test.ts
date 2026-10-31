import { describe, expect, it } from 'vitest'

import { markdownFixtures } from './fixtures.js'
import { encodeSource, sha256 } from '../src/source/encoding.js'
import { openEnvelope, openEnvelopeFromText } from '../src/source/Envelope.js'
import { fingerprint } from '../src/source/hash.js'
import { SourceBuffer } from '../src/source/SourceBuffer.js'
import {
  buildSourceMap,
  findSpanById,
  innermostSpanAt,
  reconstructSource,
  topLevelSpanAt,
  validateSourceMap,
  walkSpans,
} from '../src/source/SourceMap.js'
import type { SourceMap, SourceSpan } from '../src/source/types.js'

function expectValidMap(map: SourceMap, source: string): SourceSpan[] {
  expect(validateSourceMap(map)).toEqual([])
  expect(reconstructSource(map)).toBe(source)

  if (map.roots.length === 0) {
    expect(source).toBe('')
    return []
  }

  expect(map.roots[0]!.start).toBe(0)
  expect(map.roots[map.roots.length - 1]!.end).toBe(source.length)
  for (let index = 1; index < map.roots.length; index += 1) {
    expect(map.roots[index]!.start).toBe(map.roots[index - 1]!.end)
  }

  const ids = new Set<string>()
  for (const span of walkSpans(map.roots)) {
    expect(ids.has(span.id)).toBe(false)
    ids.add(span.id)
    expect(span.raw).toBe(source.slice(span.start, span.end))
    expect(span.fingerprint).toBe(fingerprint(span.raw))
    expect(span.contentStart).toBeGreaterThanOrEqual(span.start)
    expect(span.contentEnd).toBeLessThanOrEqual(span.end)
    expect(span.contentStart).toBeLessThanOrEqual(span.contentEnd)
    if (span.tokenType === 'text') {
      expect(span.raw).not.toMatch(/[\r\n]/)
    }
  }

  return map.roots
}

describe('source map fixtures', () => {
  for (const fixture of markdownFixtures) {
    it(`maps ${fixture.name} without losing bytes`, () => {
      const map = buildSourceMap(fixture.source)
      expectValidMap(map, fixture.source)

      const again = buildSourceMap(fixture.source)
      expect([...walkSpans(again.roots)].map(span => [span.id, span.start, span.end])).toEqual(
        [...walkSpans(map.roots)].map(span => [span.id, span.start, span.end]),
      )
    })

    it(`opens ${fixture.name} as a byte-stable no-op`, () => {
      const buffer = new SourceBuffer(openEnvelopeFromText(`${fixture.name}.md`, fixture.source))
      expect(buffer.current).toBe(fixture.source)
      expect(buffer.revision).toBe(0)
      expect(buffer.dirty).toBe(false)
      expect(buffer.canUndo).toBe(false)
      expect(buffer.currentBytes()).toEqual(encodeSource(fixture.source, 'utf-8'))
      expect(sha256(buffer.currentBytes())).toBe(buffer.baselineSha256)
    })
  }
})

describe('source map structure', () => {
  it('separates ATX prefix, content and closing hashes', () => {
    const source = '## Sub ##\n'
    const map = buildSourceMap(source)
    expectValidMap(map, source)
    const heading = map.roots[0]!
    expect(heading.tokenType).toBe('heading')
    expect(heading.attrs?.headingLevel).toBe(2)
    expect(source.slice(heading.contentStart, heading.contentEnd)).toBe('Sub')
    expect(source.slice(heading.start, heading.contentStart)).toBe('## ')
    expect(source.slice(heading.contentEnd, heading.end)).toBe(' ##\n')
  })

  it('records setext heading style and content', () => {
    const source = 'Title\n=====\n'
    const map = buildSourceMap(source)
    const heading = map.roots[0]!
    expect(heading.attrs?.headingStyle).toBe('setext')
    expect(source.slice(heading.contentStart, heading.contentEnd)).toBe('Title')
  })

  it('keeps list markers and task checkbox raw text', () => {
    const source = '* [X] done\n'
    const map = buildSourceMap(source)
    const item = [...walkSpans(map.roots)].find(span => span.tokenType === 'list_item')!
    expect(item.attrs?.marker).toBe('*')
    expect(item.attrs?.task).toBe(true)
    expect(item.attrs?.checked).toBe(true)
    expect(source.slice(item.start, item.contentStart)).toBe('* [X] ')
  })

  it('keeps parenthesized ordered list markers', () => {
    const source = '1) one\n'
    const map = buildSourceMap(source)
    const list = map.roots[0]!
    expect(list.attrs?.ordered).toBe(true)
    expect(list.attrs?.listStart).toBe(1)
    const item = [...walkSpans(map.roots)].find(span => span.tokenType === 'list_item')!
    expect(item.attrs?.marker).toBe('1)')
  })

  it('preserves hard break bytes as their own spans', () => {
    const source = 'line one  \nline two\\\nthree\n'
    const map = buildSourceMap(source)
    expectValidMap(map, source)
    const breaks = [...walkSpans(map.roots)].filter(span => span.tokenType === 'hard_break')
    expect(breaks.map(span => span.raw)).toEqual(['  \n', '\\\n'])
  })

  it('maps table rows and cells with original padding', () => {
    const source = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'
    const map = buildSourceMap(source)
    expectValidMap(map, source)
    const cells = [...walkSpans(map.roots)].filter(span => span.tokenType === 'table_cell')
    expect(cells.map(cell => cell.attrs?.value)).toEqual(['a', 'b', '1', '2'])
    expect(cells[2]!.raw).toBe(' 1 ')
    expect(cells[3]!.raw).toBe(' 2 ')
  })

  it('keeps CRLF inside gaps and out of editable text leaves', () => {
    const source = '# T\r\n\r\npara **x**\r\nnext\r\n'
    const map = buildSourceMap(source)
    expectValidMap(map, source)
    expect(
      [...walkSpans(map.roots)].some(span => span.kind === 'gap' && span.raw.includes('\r\n')),
    ).toBe(true)
    for (const span of walkSpans(map.roots)) {
      if (span.tokenType === 'text') {
        expect(span.raw).not.toContain('\r')
        expect(span.raw).not.toContain('\n')
      }
    }
  })

  it('handles an empty document', () => {
    const map = buildSourceMap('')
    expect(map.roots).toEqual([])
    expect(validateSourceMap(map)).toEqual([])
    expect(reconstructSource(map)).toBe('')
  })

  it('handles whitespace-only documents as gap spans', () => {
    const map = buildSourceMap('  \n\n\t\n')
    expect(map.roots).toHaveLength(1)
    expect(map.roots[0]!.kind).toBe('gap')
  })
})

describe('span lookup', () => {
  const source = '# Title\n\nHello **world** today\n'
  const map = buildSourceMap(source)

  it('finds top-level spans by offset', () => {
    expect(topLevelSpanAt(map, 0)?.tokenType).toBe('heading')
    expect(topLevelSpanAt(map, source.indexOf('Hello'))?.tokenType).toBe('paragraph')
    expect(topLevelSpanAt(map, source.indexOf('**world**'))?.tokenType).toBe('paragraph')
  })

  it('finds the innermost span and by id', () => {
    const wordAt = source.indexOf('world')
    const innermost = innermostSpanAt(map, wordAt)!
    expect(innermost.raw).toBe('world')
    expect(innermost.tokenType).toBe('text')
    expect(findSpanById(map, innermost.id)).toBe(innermost)
    expect(findSpanById(map, 'missing')).toBeUndefined()
  })
})

describe('safe degradation', () => {
  const ambiguousTables = {
    'pipe inside a code span': '| a | b |\n| --- | --- |\n| `x|y` | c |\n',
    'row with missing cells': '| a | b |\n| --- | --- |\n| 1 |\n',
    'escaped pipe': '| a | b |\n| --- | --- |\n| x \\| y | c |\n',
  }

  for (const [name, source] of Object.entries(ambiguousTables)) {
    it(`degrades ${name} to a raw block instead of guessing`, () => {
      const map = buildSourceMap(source)
      expect(validateSourceMap(map)).toEqual([])
      expect(reconstructSource(map)).toBe(source)
      expect(map.issues.map(issue => issue.code)).toContain('table-degraded')
      expect(map.roots).toHaveLength(1)
      expect(map.roots[0]!.kind).toBe('raw')
      expect(map.roots[0]!.tokenType).toBe('table')
      expect(map.roots[0]!.raw).toBe(source)
    })
  }
})

describe('byte-stable envelopes', () => {
  it('keeps a UTF-8 BOM document unchanged after opening', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encodeSource('# t\r\n', 'utf-8')])
    const envelope = openEnvelope('doc.md', bytes)
    const buffer = new SourceBuffer(envelope)
    expect(buffer.currentBytes()).toEqual(bytes)
    expect(sha256(buffer.currentBytes())).toBe(envelope.originalSha256)
  })

  it('keeps CRLF, no trailing newline and gb18030 unchanged', () => {
    for (const encoding of ['utf-8', 'gb18030', 'utf-16le', 'utf-16be'] as const) {
      const source = '# 标题\r\n\r\n正文'
      const bytes = encodeSource(source, encoding)
      const buffer = new SourceBuffer(openEnvelope('doc.md', bytes))
      expect(buffer.current).toBe(source)
      expect(buffer.currentBytes()).toEqual(bytes)
      expect(buffer.dirty).toBe(false)
    }
  })
})
