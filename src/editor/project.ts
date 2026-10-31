import type { JSONContent } from '@tiptap/core'

import type { ProjectedDocument, ProjectedNode } from '../source/projection.js'

export interface OutlineItem {
  level: number
  text: string
  index: number
}

function projectNode(node: ProjectedNode, insideCode: boolean): JSONContent | null {
  if (node.type === 'text') {
    if (!node.text) {
      return null
    }
    const attrs = { ...(node.attrs ?? {}) }
    const sourceId = typeof attrs.sourceId === 'string' ? attrs.sourceId : null
    delete attrs.sourceId
    const marks: Array<{ type: string; attrs?: Record<string, unknown> }> = (node.marks ?? []).map(mark => ({
      type: mark.type,
      ...(mark.attrs ? { attrs: mark.attrs } : {}),
    }))
    if (sourceId && !insideCode) {
      marks.push({ type: 'sourceAnchor', attrs: { sourceId } })
    }
    return {
      type: 'text',
      text: node.text,
      ...(marks.length > 0 ? { marks } : {}),
    }
  }

  const content: JSONContent[] = []
  const codeChild = node.type === 'codeBlock'
  for (const child of node.content ?? []) {
    const projected = projectNode(child, insideCode || codeChild)
    if (projected) {
      content.push(projected)
    }
  }

  return {
    type: node.type,
    ...(node.attrs ? { attrs: { ...node.attrs } } : {}),
    ...(content.length > 0 || node.type === 'doc' ? { content } : {}),
  }
}

export function toTiptapDocument(projected: ProjectedDocument): JSONContent {
  const doc = projectNode(projected, false)
  return doc ?? { type: 'doc', content: [] }
}

export function collectOutline(doc: JSONContent): OutlineItem[] {
  const items: OutlineItem[] = []
  const top = doc.content ?? []

  for (let index = 0; index < top.length; index += 1) {
    const node = top[index]!
    if (node.type !== 'heading') {
      continue
    }
    const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1
    const text = textContent(node).trim().replace(/\s+/g, ' ')
    if (text) {
      items.push({ level, text, index })
    }
  }

  return items
}

export function textContent(node: JSONContent): string {
  if (node.type === 'text') {
    return node.text ?? ''
  }
  if (node.type === 'hardBreak') {
    return '\n'
  }
  return (node.content ?? []).map(textContent).join('')
}

export function countWords(source: string): number {
  const trimmed = source.trim()
  if (!trimmed) {
    return 0
  }
  const cjk = trimmed.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  const words = trimmed
    .replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ')
    .match(/[A-Za-z0-9_'\u00c0-\u024f-]+/g)?.length ?? 0
  return cjk + words
}
