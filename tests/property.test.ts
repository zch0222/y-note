import { describe, expect, it } from 'vitest'
import fc from 'fast-check'

import { encodeSource } from '../src/source/encoding.js'
import { openEnvelope, openEnvelopeFromText } from '../src/source/Envelope.js'
import { setSpanText } from '../src/source/patch.js'
import { SourceBuffer } from '../src/source/SourceBuffer.js'
import { validateSourceMap, walkSpans } from '../src/source/SourceMap.js'
import type { SourceSpan } from '../src/source/types.js'

const SAFE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789中文，.:/ ()\'"'.split('')
const safeString = (minLength: number, maxLength: number) =>
  fc.string({
    unit: fc.constantFrom(...SAFE_CHARS),
    minLength,
    maxLength,
  })

const paragraphText = fc
  .array(safeString(1, 6), { minLength: 1, maxLength: 5 })
  .map(words => words.join(' '))

const documentArbitrary = fc
  .array(paragraphText, { minLength: 1, maxLength: 4 })
  .map(paragraphs => `# Title\n\n${paragraphs.join('\n\n')}\n`)

const editArbitrary = fc.record({
  block: fc.nat(),
  leaf: fc.nat(),
  replacement: safeString(1, 8),
})

function bufferFor(source: string): SourceBuffer {
  return new SourceBuffer(openEnvelopeFromText('doc.md', source))
}

function paragraphsOf(buffer: SourceBuffer): SourceSpan[] {
  return buffer.roots.filter(root => root.tokenType === 'paragraph')
}

function textLeaves(span: SourceSpan): SourceSpan[] {
  return [...walkSpans([span])].filter(
    candidate => candidate.tokenType === 'text' && candidate.raw.length > 0,
  )
}

describe('randomised invariants', () => {
  it('starts from and preserves a fully mapped document', () => {
    fc.assert(
      fc.property(documentArbitrary, source => {
        const map = bufferFor(source).map
        expect(validateSourceMap(map)).toEqual([])
      }),
    )
  })

  it('preserves bytes outside an edited leaf and survives full undo and redo', () => {
    fc.assert(
      fc.property(documentArbitrary, fc.array(editArbitrary, { maxLength: 4 }), (source, edits) => {
        const buffer = bufferFor(source)
        let applied = 0

        for (const edit of edits) {
          const paragraphs = paragraphsOf(buffer)
          if (paragraphs.length === 0) {
            continue
          }
          const block = paragraphs[edit.block % paragraphs.length]!
          const leaves = textLeaves(block)
          if (leaves.length === 0) {
            continue
          }
          const leaf = leaves[edit.leaf % leaves.length]!
          const prefix = buffer.current.slice(0, leaf.start)
          const suffix = buffer.current.slice(leaf.end)
          const result = setSpanText(buffer, leaf.id, edit.replacement)
          if (!result.applied) {
            continue
          }
          applied += 1
          expect(buffer.current.startsWith(prefix)).toBe(true)
          expect(buffer.current.endsWith(suffix)).toBe(true)
          expect(validateSourceMap(buffer.map)).toEqual([])
          expect(buffer.current).toContain(edit.replacement)
        }

        const afterEdits = buffer.current
        for (let index = 0; index < applied; index += 1) {
          expect(buffer.undo().applied).toBe(true)
        }
        expect(buffer.current).toBe(source)
        expect(buffer.currentBytes()).toEqual(encodeSource(source, 'utf-8'))
        expect(validateSourceMap(buffer.map)).toEqual([])

        for (let index = 0; index < applied; index += 1) {
          expect(buffer.redo().applied).toBe(true)
        }
        expect(buffer.current).toBe(afterEdits)
        expect(validateSourceMap(buffer.map)).toEqual([])
      }),
      { numRuns: 60 },
    )
  })

  it('replaces every leaf change deterministically', () => {
    fc.assert(
      fc.property(documentArbitrary, editArbitrary, (source, edit) => {
        const first = bufferFor(source)
        const second = bufferFor(source)
        const paragraphs = paragraphsOf(first)
        if (paragraphs.length === 0) {
          return
        }
        const block = paragraphs[edit.block % paragraphs.length]!
        const leaves = textLeaves(block)
        if (leaves.length === 0) {
          return
        }
        const leaf = leaves[edit.leaf % leaves.length]!

        setSpanText(first, leaf.id, edit.replacement)
        const secondLeaf = textLeaves(paragraphsOf(second)[edit.block % paragraphs.length]!)[
          edit.leaf % leaves.length
        ]!
        setSpanText(second, secondLeaf.id, edit.replacement)
        expect(first.current).toBe(second.current)
        expect(
          first.roots.map(root => [root.id, root.raw]),
        ).toEqual(second.roots.map(root => [root.id, root.raw]))
      }),
      { numRuns: 60 },
    )
  })

  it('opens arbitrary unicode text without altering or failing to map it', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), text => {
        const bytes = encodeSource(text, 'utf-8')
        const buffer = new SourceBuffer(openEnvelope('doc.md', bytes))
        expect(buffer.current).toBe(text)
        expect(buffer.currentBytes()).toEqual(bytes)
        expect(buffer.dirty).toBe(false)
        expect(validateSourceMap(buffer.map)).toEqual([])
      }),
      { numRuns: 120 },
    )
  })
})
