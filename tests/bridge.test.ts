import { Schema } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'

import { selectionFromHint, selectionRangeFromHint } from '../src/editor/bridge.js'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      attrs: { sourceId: { default: null } },
    },
    heading: {
      content: 'inline*',
      group: 'block',
      attrs: { level: { default: 1 } },
    },
    text: { group: 'inline' },
  },
})

const doc = schema.node('doc', null, [
  schema.node('paragraph', { sourceId: 'a' }, [schema.text('hello')]),
  schema.node('heading', { level: 2 }, [schema.text('title')]),
])

describe('selectionFromHint', () => {
  it('maps a block offset to the exact document position', () => {
    expect(selectionFromHint(doc, { blockIndex: 0, offset: 0 })).toBe(1)
    expect(selectionFromHint(doc, { blockIndex: 0, offset: 3 })).toBe(4)
    expect(selectionFromHint(doc, { blockIndex: 1, offset: 0 })).toBe(8)
    expect(selectionFromHint(doc, { blockIndex: 1, offset: 2 })).toBe(10)
  })

  it('clamps offsets and block indexes', () => {
    expect(selectionFromHint(doc, { blockIndex: 0, offset: 99 })).toBe(6)
    expect(selectionFromHint(doc, { blockIndex: 99, offset: 99 })).toBe(doc.content.size - 1)
    expect(selectionFromHint(doc, { blockIndex: -3, offset: -4 })).toBe(1)
  })

  it('falls back to the start of the document without a hint', () => {
    expect(selectionFromHint(doc)).toBe(1)
  })

  it('restores a range inside the hinted block', () => {
    expect(selectionRangeFromHint(doc, { blockIndex: 0, offset: 1, endOffset: 4 })).toEqual({
      from: 2,
      to: 5,
    })
    expect(selectionRangeFromHint(doc, { blockIndex: 1, offset: 1, endOffset: 99 })).toEqual({
      from: 9,
      to: 13,
    })
    expect(selectionRangeFromHint(doc, { blockIndex: 0, offset: 3 })).toEqual({
      from: 4,
      to: 4,
    })
  })
})
