import { describe, expect, it } from 'vitest'

import { openEnvelopeFromText } from '../src/source/Envelope.js'
import { projectDocument } from '../src/source/projection.js'
import type { ProjectedNode } from '../src/source/projection.js'
import { setSpanText } from '../src/source/patch.js'
import { SourceBuffer } from '../src/source/SourceBuffer.js'
import { buildSourceMap, findSpanById, walkSpans } from '../src/source/SourceMap.js'

function nodesOf(node: ProjectedNode): ProjectedNode[] {
  const result: ProjectedNode[] = [node]
  for (const child of node.content ?? []) {
    result.push(...nodesOf(child))
  }
  return result
}

function textOf(node: ProjectedNode): string {
  if (node.text !== undefined) {
    return node.text
  }
  return (node.content ?? []).map(textOf).join('')
}

function byType(doc: ProjectedNode, type: string): ProjectedNode[] {
  return nodesOf(doc).filter(node => node.type === type)
}

describe('projection', () => {
  it('projects inline marks with their attributes and source ids', () => {
    const source = 'a **b** *i* ~~s~~ `c` [l](https://x "t")\n'
    const map = buildSourceMap(source)
    const doc = projectDocument(map)
    const paragraph = doc.content![0]!

    expect(paragraph.type).toBe('paragraph')
    const textNodes = byType(paragraph, 'text')
    expect(textNodes.map(node => node.text)).toEqual([
      'a ',
      'b',
      ' ',
      'i',
      ' ',
      's',
      ' ',
      'c',
      ' ',
      'l',
    ])
    expect(textNodes[1]!.marks).toEqual([{ type: 'bold' }])
    expect(textNodes[3]!.marks).toEqual([{ type: 'italic' }])
    expect(textNodes[5]!.marks).toEqual([{ type: 'strike' }])
    expect(textNodes[7]!.marks).toEqual([{ type: 'code' }])
    expect(textNodes[9]!.marks).toEqual([
      { type: 'link', attrs: { href: 'https://x', title: 't' } },
    ])

    for (const node of nodesOf(doc)) {
      const sourceId = node.attrs?.sourceId
      if (typeof sourceId === 'string') {
        expect(findSpanById(map, sourceId)).toBeDefined()
      }
    }
  })

  it('projects headings, quotes, lists, tables, code and rules', () => {
    const source = [
      '## Heading',
      '',
      '> quoted',
      '',
      '- [x] done',
      '',
      '1. first',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```ts',
      'let x = 1',
      '```',
      '',
      '---',
      '',
    ].join('\n')
    const doc = projectDocument(buildSourceMap(source))

    const heading = byType(doc, 'heading')[0]!
    expect(heading.attrs?.level).toBe(2)
    expect(textOf(heading)).toBe('Heading')

    expect(byType(doc, 'blockquote')).toHaveLength(1)
    const listItem = byType(doc, 'listItem')[0]!
    expect(listItem.attrs?.checked).toBe(true)
    const ordered = byType(doc, 'orderedList')[0]!
    expect(ordered.attrs?.start).toBe(1)

    const headers = byType(doc, 'tableHeader')
    const cells = byType(doc, 'tableCell')
    expect(headers.map(textOf)).toEqual(['a', 'b'])
    expect(cells.map(textOf)).toEqual(['1', '2'])
    expect(cells[0]!.content?.[0]?.type).toBe('paragraph')

    const code = byType(doc, 'codeBlock')[0]!
    expect(code.attrs?.language).toBe('ts')
    expect(textOf(code)).toBe('let x = 1')

    expect(byType(doc, 'horizontalRule')).toHaveLength(1)
  })

  it('projects hard breaks separately from soft line breaks', () => {
    const doc = projectDocument(buildSourceMap('one  \ntwo\n'))
    const paragraph = doc.content![0]!
    expect(paragraph.content?.map(node => node.type)).toEqual(['text', 'hardBreak', 'text'])
    expect(paragraph.content?.[0]?.text).toBe('one')
    expect(paragraph.content?.[2]?.text).toBe('two')
  })

  it('normalizes CRLF soft breaks to newline text without carriage returns', () => {
    const doc = projectDocument(buildSourceMap('line one\r\nline two\r\n'))
    const paragraph = doc.content![0]!
    expect(paragraph.content?.[1]?.text).toBe('\n')
    expect(JSON.stringify(doc)).not.toContain('\\r')
  })

  it('projects images with alt, source and title', () => {
    const doc = projectDocument(buildSourceMap('![alt *text*](img.png "t")\n'))
    const image = byType(doc, 'image')[0]!
    expect(image.attrs).toMatchObject({ src: 'img.png', alt: 'alt *text*', title: 't' })
  })

  it('projects front matter, link definitions, inline html and degraded tables as raw', () => {
    const source = [
      '---',
      'title: hi',
      '---',
      '',
      '[ref][id]',
      '',
      '[id]: https://x',
      '',
      'a <span>b</span> c',
      '',
      '| a | b |',
      '| --- | --- |',
      '| `x|y` | c |',
      '',
    ].join('\n')
    const doc = projectDocument(buildSourceMap(source))

    expect(byType(doc, 'frontMatter')[0]?.attrs?.raw).toContain('title: hi')
    expect(byType(doc, 'linkReferenceDefinition')[0]?.attrs?.raw).toBe(
      '[id]: https://x\n\n',
    )
    const inlineRaw = byType(doc, 'rawInline')
    expect(inlineRaw.map(node => node.attrs?.raw)).toEqual(['<span>', '</span>'])
    const raw = byType(doc, 'rawBlock')
    expect(raw).toHaveLength(1)
    expect(raw[0]!.attrs?.raw).toContain('`x|y`')
  })

  it('reflects edits and refreshed source ids', () => {
    const buffer = new SourceBuffer(openEnvelopeFromText('doc.md', 'Hello **world**\n'))
    const target = [...walkSpans(buffer.roots)].find(
      span => span.tokenType === 'text' && span.attrs?.value === 'world',
    )!
    setSpanText(buffer, target.id, 'there')

    const doc = projectDocument(buffer.map)
    expect(textOf(doc.content![0]!)).toBe('Hello there')
    const boldText = byType(doc, 'text').find(node => node.text === 'there')!
    expect(boldText.marks).toEqual([{ type: 'bold' }])
    for (const node of nodesOf(doc)) {
      const sourceId = node.attrs?.sourceId
      if (typeof sourceId === 'string') {
        expect(findSpanById(buffer.map, sourceId)).toBeDefined()
      }
    }
  })
})
