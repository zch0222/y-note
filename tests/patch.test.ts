import { describe, expect, it } from 'vitest'

import { openEnvelopeFromText } from '../src/source/Envelope.js'
import { walkSpans } from '../src/source/SourceMap.js'
import { SourceBuffer } from '../src/source/SourceBuffer.js'
import { buildSourceMap, validateSourceMap } from '../src/source/SourceMap.js'
import {
  analyzeDelimiterPreferences,
  replaceBlockRaw,
  replaceText,
  setHeadingLevel,
  setListItemMarker,
  setSpanText,
  setTaskChecked,
  toggleMark,
} from '../src/source/patch.js'
import type { MarkType } from '../src/source/patch.js'
import type { PatchResult } from '../src/source/types.js'
import type { SourceSpan } from '../src/source/types.js'

function bufferFor(source: string): SourceBuffer {
  return new SourceBuffer(openEnvelopeFromText('test.md', source))
}

function allSpans(buffer: SourceBuffer): SourceSpan[] {
  return [...walkSpans(buffer.roots)]
}

function textByValue(buffer: SourceBuffer, value: string): SourceSpan {
  const span = allSpans(buffer).find(
    candidate => candidate.tokenType === 'text' && candidate.attrs?.value === value,
  )
  if (!span) {
    throw new Error(`No text span with value ${JSON.stringify(value)}`)
  }
  return span
}

function paragraph(buffer: SourceBuffer, rawIncludes?: string): SourceSpan {
  const span = allSpans(buffer).find(
    candidate =>
      candidate.tokenType === 'paragraph' &&
      (rawIncludes === undefined || candidate.raw.includes(rawIncludes)),
  )
  if (!span) {
    throw new Error('No matching paragraph')
  }
  return span
}

function mark(
  buffer: SourceBuffer,
  block: SourceSpan,
  selected: string,
  type: MarkType,
  enabled: boolean,
): PatchResult {
  const offset = buffer.current.indexOf(selected, block.contentStart)
  expect(offset).toBeGreaterThanOrEqual(block.contentStart)
  return toggleMark(buffer, {
    spanId: block.id,
    from: offset - block.contentStart,
    to: offset + selected.length - block.contentStart,
    mark: type,
    enabled,
  })
}

function expectValid(buffer: SourceBuffer): void {
  expect(validateSourceMap(buffer.map)).toEqual([])
}

describe('S0 no-op transactions', () => {
  it('does not create a revision for empty edits', () => {
    const buffer = bufferFor('hello\n')
    expect(buffer.applyEdits([], 'S1')).toMatchObject({ applied: false, revision: 0 })
    expect(buffer.applyEdits([{ from: 0, to: 0, insert: '' }], 'S1')).toMatchObject({
      applied: false,
      revision: 0,
    })
    expect(buffer.revision).toBe(0)
  })

  it('does not create a revision when the text is identical', () => {
    const buffer = bufferFor('hello\n')
    expect(buffer.applyEdits([{ from: 0, to: 1, insert: 'h' }], 'S1')).toMatchObject({
      level: 'S0',
      applied: false,
      revision: 0,
    })
    expect(buffer.current).toBe('hello\n')
  })
})

describe('S1 text replacement', () => {
  it('replaces only the selected leaf and preserves untouched delimiters', () => {
    const source = '这是 __重点__ 内容\n'
    const buffer = bufferFor(source)
    const result = setSpanText(buffer, textByValue(buffer, ' 内容').id, ' 正文')
    expect(result.applied).toBe(true)
    expect(result.level).toBe('S1')
    expect(buffer.current).toBe('这是 __重点__ 正文\n')
    expect(buffer.current.slice(0, buffer.current.indexOf('正文'))).toBe(
      source.slice(0, source.indexOf('内容')),
    )
    expectValid(buffer)
  })

  it('keeps reference link definitions untouched', () => {
    const source = '[text][id]\n\n[id]: https://example.com "T"\n'
    const buffer = bufferFor(source)
    setSpanText(buffer, textByValue(buffer, 'text').id, 'label')
    expect(buffer.current).toBe('[label][id]\n\n[id]: https://example.com "T"\n')
    expectValid(buffer)
  })

  it('keeps the original list bullet', () => {
    const source = '* item\n'
    const buffer = bufferFor(source)
    setSpanText(buffer, textByValue(buffer, 'item').id, 'entry')
    expect(buffer.current).toBe('* entry\n')
  })

  it('keeps ordered list markers and starting numbers', () => {
    const source = '3) three\n4) four\n'
    const buffer = bufferFor(source)
    setSpanText(buffer, textByValue(buffer, 'four').id, 'FOUR')
    expect(buffer.current).toBe('3) three\n4) FOUR\n')
  })

  it('edits one table cell without reflowing the table', () => {
    const source = '| left | center | right |\n|:-----|:------:|------:|\n| a  |   b   |     c |\n'
    const buffer = bufferFor(source)
    setSpanText(buffer, textByValue(buffer, 'b').id, 'B')
    expect(buffer.current).toBe(
      '| left | center | right |\n|:-----|:------:|------:|\n| a  |   B   |     c |\n',
    )
    expectValid(buffer)
  })

  it('keeps blockquote prefixes', () => {
    const source = '> quoted text\n'
    const buffer = bufferFor(source)
    setSpanText(buffer, textByValue(buffer, 'quoted text').id, 'edited text')
    expect(buffer.current).toBe('> edited text\n')
  })

  it('keeps trailing two-space hard breaks elsewhere in the paragraph', () => {
    const source = 'first  \nsecond\n'
    const buffer = bufferFor(source)
    setSpanText(buffer, textByValue(buffer, 'second').id, 'changed')
    expect(buffer.current).toBe('first  \nchanged\n')
    expectValid(buffer)
  })

  it('keeps tilde code fences untouched when editing another block', () => {
    const source = '~~~js\nconst x = 1\n~~~\n\npara\n'
    const buffer = bufferFor(source)
    setSpanText(buffer, textByValue(buffer, 'para').id, 'changed')
    expect(buffer.current).toBe('~~~js\nconst x = 1\n~~~\n\nchanged\n')
  })

  it('reports dirty ranges in the edited buffer', () => {
    const buffer = bufferFor('hello world\n')
    const target = textByValue(buffer, 'hello world')
    const result = replaceText(buffer, { spanId: target.id, from: 6, to: 11, insert: 'there' })
    expect(result.dirty).toEqual([{ from: 6, to: 11 }])
    expect(result.affectedSpanIds.length).toBeGreaterThan(0)
  })

  it('replaces an emoji without splitting surrogate pairs', () => {
    const buffer = bufferFor('😀 text\n')
    const target = textByValue(buffer, '😀 text')
    const result = replaceText(buffer, { spanId: target.id, from: 0, to: 2, insert: '🙂' })
    expect(result.applied).toBe(true)
    expect(buffer.current).toBe('🙂 text\n')
    expectValid(buffer)
  })

  it('refuses selections that split a surrogate pair', () => {
    const buffer = bufferFor('😀 text\n')
    const target = textByValue(buffer, '😀 text')
    const result = replaceText(buffer, { spanId: target.id, from: 1, to: 2, insert: 'x' })
    expect(result).toMatchObject({ level: 'S5', applied: false, revision: -1 })
    expect(result.requiresSourceEdit).toBe(true)
    expect(buffer.current).toBe('😀 text\n')
  })

  it('refuses newline insertion at S1', () => {
    const buffer = bufferFor('hello world\n')
    const target = textByValue(buffer, 'hello world')
    const result = replaceText(buffer, { spanId: target.id, from: 5, to: 6, insert: '\n' })
    expect(result.level).toBe('S4')
    expect(result.applied).toBe(false)
    expect(buffer.current).toBe('hello world\n')
  })

  it('refuses to rewrite raw blocks as text', () => {
    const source = '```\ncode\n```\n'
    const buffer = bufferFor(source)
    const code = allSpans(buffer).find(span => span.tokenType === 'code_block')!
    const result = replaceText(buffer, { spanId: code.id, from: 0, to: 1, insert: 'x' })
    expect(result).toMatchObject({ level: 'S5', applied: false, revision: -1 })
    expect(buffer.current).toBe(source)
  })

  it('refuses to rewrite atomic inline images', () => {
    const buffer = bufferFor('![alt](x.png)\n')
    const image = allSpans(buffer).find(span => span.tokenType === 'image')!
    const result = replaceText(buffer, { spanId: image.id, from: 0, to: 1, insert: 'x' })
    expect(result.level).toBe('S5')
    expect(buffer.current).toBe('![alt](x.png)\n')
  })

  it('rejects out-of-bounds ranges', () => {
    const buffer = bufferFor('abc\n')
    const target = textByValue(buffer, 'abc')
    expect(() =>
      replaceText(buffer, { spanId: target.id, from: 0, to: 99, insert: 'x' }),
    ).toThrow(/outside span/)
  })
})

describe('S2 inline marks', () => {
  it('follows an existing underscore bold preference', () => {
    const source = 'a __b__ plain text\n'
    const buffer = bufferFor(source)
    const result = mark(buffer, paragraph(buffer), 'plain text', 'bold', true)
    expect(result.level).toBe('S2')
    expect(buffer.current).toBe('a __b__ __plain text__\n')
    expectValid(buffer)
  })

  it('uses double stars by default', () => {
    const buffer = bufferFor('a plain text\n')
    mark(buffer, paragraph(buffer), 'plain', 'bold', true)
    expect(buffer.current).toBe('a **plain** text\n')
  })

  it('avoids underscores between word characters', () => {
    const buffer = bufferFor('a __b__ word\n')
    const result = mark(buffer, paragraph(buffer), 'or', 'bold', true)
    expect(result.applied).toBe(true)
    expect(buffer.current).toBe('a __b__ w**or**d\n')
  })

  it('follows an existing underscore italic preference', () => {
    const buffer = bufferFor('a _i_ text\n')
    mark(buffer, paragraph(buffer), 'text', 'italic', true)
    expect(buffer.current).toBe('a _i_ _text_\n')
  })

  it('uses stars for intraword italic when underscores are preferred', () => {
    const buffer = bufferFor('a _i_ word\n')
    mark(buffer, paragraph(buffer), 'or', 'italic', true)
    expect(buffer.current).toBe('a _i_ w*or*d\n')
  })

  it('applies strike and code marks', () => {
    const strikeBuffer = bufferFor('a b\n')
    mark(strikeBuffer, paragraph(strikeBuffer), 'b', 'strike', true)
    expect(strikeBuffer.current).toBe('a ~~b~~\n')

    const codeBuffer = bufferFor('a b\n')
    mark(codeBuffer, paragraph(codeBuffer), 'b', 'code', true)
    expect(codeBuffer.current).toBe('a `b`\n')
  })

  it('removes bold delimiters without touching neighbours', () => {
    const buffer = bufferFor('a **b** c\n')
    const result = mark(buffer, paragraph(buffer), 'b', 'bold', false)
    expect(result.level).toBe('S2')
    expect(buffer.current).toBe('a b c\n')
    expectValid(buffer)
  })

  it('is a no-op when the mark is already applied', () => {
    const buffer = bufferFor('a **b** c\n')
    const result = mark(buffer, paragraph(buffer), 'b', 'bold', true)
    expect(result).toMatchObject({ level: 'S0', applied: false })
    expect(buffer.current).toBe('a **b** c\n')
  })

  it('refuses partial mark removal', () => {
    const buffer = bufferFor('a **bold** c\n')
    const result = mark(buffer, paragraph(buffer), 'ol', 'bold', false)
    expect(result.level).toBe('S5')
    expect(buffer.current).toBe('a **bold** c\n')
  })

  it('refuses a wrap that would not parse as the requested mark', () => {
    const buffer = bufferFor('a plain\n')
    const result = mark(buffer, paragraph(buffer), ' plain', 'bold', true)
    expect(result.level).toBe('S5')
    expect(result.applied).toBe(false)
    expect(buffer.current).toBe('a plain\n')
  })

  it('refuses inline marks spanning a line break', () => {
    const buffer = bufferFor('one  \ntwo\n')
    const block = paragraph(buffer)
    const result = toggleMark(buffer, {
      spanId: block.id,
      from: 2,
      to: block.contentEnd - block.contentStart,
      mark: 'bold',
      enabled: true,
    })
    expect(result.level).toBe('S5')
  })

  it('detects document delimiter preferences', () => {
    const map = buildSourceMap('__a__ __b__ _c_ _d_ **e** *f*\n')
    expect(analyzeDelimiterPreferences(map)).toEqual({ bold: '__', italic: '_' })
    const starMap = buildSourceMap('**a** *b*\n')
    expect(analyzeDelimiterPreferences(starMap)).toEqual({ bold: '**', italic: '*' })
  })
})

describe('S3 block structure', () => {
  it('changes ATX heading levels and keeps closing hashes', () => {
    const buffer = bufferFor('## Title ##\n\nbody\n')
    const heading = allSpans(buffer).find(span => span.tokenType === 'heading')!
    const result = setHeadingLevel(buffer, heading.id, 3)
    expect(result.level).toBe('S3')
    expect(buffer.current).toBe('### Title ##\n\nbody\n')
    expectValid(buffer)
  })

  it('removes an ATX prefix and closing hashes when demoting to paragraph', () => {
    const buffer = bufferFor('## Title ##\n\nbody\n')
    const heading = allSpans(buffer).find(span => span.tokenType === 'heading')!
    setHeadingLevel(buffer, heading.id, 0)
    expect(buffer.current).toBe('Title\n\nbody\n')
  })

  it('promotes a paragraph to a heading', () => {
    const buffer = bufferFor('Title\n\nbody\n')
    const block = paragraph(buffer, 'Title')
    setHeadingLevel(buffer, block.id, 2)
    expect(buffer.current).toBe('## Title\n\nbody\n')
  })

  it('is a no-op for level 0 on a paragraph', () => {
    const buffer = bufferFor('Title\n')
    const result = setHeadingLevel(buffer, paragraph(buffer).id, 0)
    expect(result).toMatchObject({ level: 'S0', applied: false })
  })

  it('refuses setext heading level changes', () => {
    const buffer = bufferFor('Title\n=====\n')
    const heading = allSpans(buffer).find(span => span.tokenType === 'heading')!
    const result = setHeadingLevel(buffer, heading.id, 2)
    expect(result.level).toBe('S5')
    expect(buffer.current).toBe('Title\n=====\n')
  })

  it('changes a same-width list marker', () => {
    const buffer = bufferFor('- item\n')
    const item = allSpans(buffer).find(span => span.tokenType === 'list_item')!
    const result = setListItemMarker(buffer, item.id, '*')
    expect(result.level).toBe('S3')
    expect(buffer.current).toBe('* item\n')
  })

  it('keeps nested indentation when changing a marker', () => {
    const buffer = bufferFor('- a\n  - b\n')
    const items = allSpans(buffer).filter(span => span.tokenType === 'list_item')
    const target = items[items.length - 1]!
    expect(target.attrs?.marker).toBe('-')
    setListItemMarker(buffer, target.id, '*')
    expect(buffer.current).toBe('- a\n  * b\n')
  })

  it('refuses marker width changes that would reindent content', () => {
    const buffer = bufferFor('- item\n')
    const item = allSpans(buffer).find(span => span.tokenType === 'list_item')!
    const result = setListItemMarker(buffer, item.id, '1.')
    expect(result.level).toBe('S4')
    expect(buffer.current).toBe('- item\n')
  })

  it('rejects invalid list markers', () => {
    const buffer = bufferFor('- item\n')
    const item = allSpans(buffer).find(span => span.tokenType === 'list_item')!
    expect(() => setListItemMarker(buffer, item.id, 'x')).toThrow(/Invalid list marker/)
  })

  it('checks and unchecks task items', () => {
    const buffer = bufferFor('* [ ] todo\n* [X] Done\n')
    const items = allSpans(buffer).filter(span => span.tokenType === 'list_item')
    expect(setTaskChecked(buffer, items[0]!.id, true).applied).toBe(true)
    expect(setTaskChecked(buffer, items[1]!.id, false).applied).toBe(true)
    expect(buffer.current).toBe('* [x] todo\n* [ ] Done\n')
    expectValid(buffer)
  })

  it('refuses task toggles on plain list items', () => {
    const buffer = bufferFor('- plain\n')
    const item = allSpans(buffer).find(span => span.tokenType === 'list_item')!
    expect(setTaskChecked(buffer, item.id, true).level).toBe('S5')
  })

  it('replaces a degraded table through local source editing', () => {
    const source = '| a | b |\n| --- | --- |\n| `x|y` | c |\n'
    const buffer = bufferFor(source)
    const table = buffer.roots[0]!
    expect(table.kind).toBe('raw')
    const result = replaceBlockRaw(buffer, table.id, '| a | b |\n| --- | --- |\n| x | c |\n')
    expect(result.applied).toBe(true)
    expect(buffer.map.issues).toEqual([])
    expect(buffer.current).toBe('| a | b |\n| --- | --- |\n| x | c |\n')
    expectValid(buffer)
  })
})

describe('undo and redo', () => {
  it('restores exact bytes through edits, undo and redo', () => {
    const source = '# Title\n\nHello **world** today\n\n- item\n'
    const buffer = bufferFor(source)
    setSpanText(buffer, textByValue(buffer, 'world').id, 'there')
    const afterFirst = buffer.current
    setSpanText(buffer, textByValue(buffer, 'item').id, 'entry')
    const afterSecond = buffer.current

    expect(buffer.undo().applied).toBe(true)
    expect(buffer.current).toBe(afterFirst)
    expect(buffer.undo().applied).toBe(true)
    expect(buffer.current).toBe(source)
    expect(buffer.canUndo).toBe(false)

    expect(buffer.redo().applied).toBe(true)
    expect(buffer.current).toBe(afterFirst)
    expect(buffer.redo().applied).toBe(true)
    expect(buffer.current).toBe(afterSecond)
    expect(buffer.canRedo).toBe(false)
  })

  it('undoes mark application exactly', () => {
    const source = 'a plain text\n'
    const buffer = bufferFor(source)
    mark(buffer, paragraph(buffer), 'plain', 'bold', true)
    expect(buffer.current).toBe('a **plain** text\n')
    buffer.undo()
    expect(buffer.current).toBe(source)
    expect(buffer.dirty).toBe(false)
  })

  it('clears the redo stack after a new edit', () => {
    const buffer = bufferFor('one\n')
    setSpanText(buffer, textByValue(buffer, 'one').id, 'two')
    buffer.undo()
    expect(buffer.canRedo).toBe(true)
    setSpanText(buffer, textByValue(buffer, 'one').id, 'three')
    expect(buffer.canRedo).toBe(false)
    expect(buffer.current).toBe('three\n')
  })

  it('returns an S0 result for undo with empty history', () => {
    const buffer = bufferFor('one\n')
    expect(buffer.undo()).toMatchObject({ applied: false, level: 'S0' })
    expect(buffer.redo()).toMatchObject({ applied: false, level: 'S0' })
  })

  it('keeps the map valid after every step', () => {
    const buffer = bufferFor('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    const target = textByValue(buffer, '2')
    setSpanText(buffer, target.id, '22')
    expectValid(buffer)
    buffer.undo()
    expectValid(buffer)
    buffer.redo()
    expectValid(buffer)
    expect(buffer.current).toContain('22')
  })
})
