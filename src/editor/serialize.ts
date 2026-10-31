import type { JSONContent } from '@tiptap/core'

import { textContent } from './project.js'

interface MarkInfo {
  href?: string
  title?: string
}

function marksOf(node: JSONContent): Map<string, MarkInfo> {
  const result = new Map<string, MarkInfo>()
  for (const mark of node.marks ?? []) {
    if (mark.type === 'sourceAnchor') {
      continue
    }
    result.set(mark.type, (mark.attrs ?? {}) as MarkInfo)
  }
  return result
}

function escapeInline(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, '\\$1')
}

function protectLineStart(line: string): string {
  if (/^(?:#{1,6}[ \t]|>|[-+*][ \t]|\d{1,9}[.)][ \t])/.test(line)) {
    return `\\${line}`
  }
  return line
}

function codeSpan(text: string): string {
  let longest = 0
  let current = 0
  for (const char of text) {
    if (char === '`') {
      current += 1
      longest = Math.max(longest, current)
    } else {
      current = 0
    }
  }
  const fence = '`'.repeat(longest + 1)
  const padded = /^ | $/.test(text) ? ` ${text} ` : text
  return `${fence}${padded}${fence}`
}

function serializeText(node: JSONContent): string {
  const marks = marksOf(node)
  let value = node.text ?? ''

  if (marks.has('code')) {
    return codeSpan(value)
  }

  value = escapeInline(value)
  if (marks.has('strike')) {
    value = `~~${value}~~`
  }
  if (marks.has('italic')) {
    value = `*${value}*`
  }
  if (marks.has('bold')) {
    value = `**${value}**`
  }

  const link = marks.get('link')
  if (link?.href) {
    const href = /[\s()<>]/.test(link.href) ? `<${link.href}>` : link.href
    const title = link.title ? ` "${link.title.replace(/"/g, '\\"')}"` : ''
    value = `[${value}](${href}${title})`
  }

  return value
}

export function serializeInline(nodes: JSONContent[] | undefined): string {
  if (!nodes) {
    return ''
  }

  let result = ''
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        result += serializeText(node)
        break
      case 'hardBreak':
        result += '  \n'
        break
      case 'rawInline':
        result += String(node.attrs?.raw ?? '')
        break
      case 'image': {
        const alt = String(node.attrs?.alt ?? '').replace(/[\]]/g, '\\]')
        const src = String(node.attrs?.src ?? '')
        const title = node.attrs?.title ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"` : ''
        result += `![${alt}](${src}${title})`
        break
      }
      default:
        result += escapeInline(textContent(node))
        break
    }
  }
  return result
}

function indentLines(text: string, indent: string): string {
  return text
    .split('\n')
    .map(line => (line.length > 0 ? indent + line : line))
    .join('\n')
}

function serializeList(node: JSONContent, indent: string): string | null {
  const ordered = node.type === 'orderedList'
  const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1
  const lines: string[] = []

  for (let index = 0; index < (node.content ?? []).length; index += 1) {
    const item = node.content![index]!
    if (item.type !== 'listItem') {
      return null
    }

    let marker = ''
    if (typeof item.attrs?.marker === 'string') {
      marker = item.attrs.marker
    } else {
      marker = ordered ? `${start + index}.` : '-'
    }
    if (ordered && !/^\d{1,9}[.)]$/.test(marker)) {
      marker = `${start + index}.`
    }
    if (!ordered && !/^[-+*]$/.test(marker)) {
      marker = '-'
    }

    const blocks = item.content ?? []
    if (blocks.length === 0 || blocks[0]!.type !== 'paragraph') {
      return null
    }

    const checked = item.attrs?.checked
    const checkbox =
      checked === null || checked === undefined ? '' : checked ? '[x] ' : '[ ] '
    const main = `${indent}${marker} ${checkbox}${serializeInline(blocks[0]!.content)}`.replace(
      /\s+$/,
      '',
    )
    lines.push(main)

    for (const child of blocks.slice(1)) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        const nested = serializeList(child, `${indent}${' '.repeat(marker.length + 1)}`)
        if (nested === null) {
          return null
        }
        lines.push(nested)
      } else {
        const block = serializeBlock(child, `${indent}${' '.repeat(marker.length + 1)}`)
        if (block === null) {
          return null
        }
        lines.push(indentLines(block, ''))
      }
    }
  }

  return lines.join('\n')
}

function serializeBlockquote(node: JSONContent, indent: string): string | null {
  const parts: string[] = []
  for (const child of node.content ?? []) {
    const block = serializeBlock(child, '')
    if (block === null) {
      return null
    }
    parts.push(block)
  }
  const body = parts.join('\n\n')
  const quoted = body
    .split('\n')
    .map(line => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n')
  return indentLines(quoted, indent)
}

function serializeCodeBlock(node: JSONContent): string {
  const code = textContent(node)
  let longest = 0
  for (const match of code.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length)
  }
  const fence = '`'.repeat(Math.max(3, longest + 1))
  const language = String(node.attrs?.language ?? '')
  return `${fence}${language}\n${code}\n${fence}`
}

export function serializeBlock(node: JSONContent, indent = ''): string | null {
  switch (node.type) {
    case 'paragraph': {
      const inline = serializeInline(node.content)
      if (!inline) {
        return ''
      }
      return indentLines(protectLineStart(inline), indent)
    }
    case 'heading': {
      const style = node.attrs?.headingStyle
      if (style === 'setext') {
        return null
      }
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1
      const inline = serializeInline(node.content)
      return indentLines(`${'#'.repeat(Math.min(6, Math.max(1, level)))} ${inline}`.trimEnd(), indent)
    }
    case 'bulletList':
    case 'orderedList':
      return serializeList(node, indent)
    case 'blockquote':
      return serializeBlockquote(node, indent)
    case 'codeBlock':
      return indentLines(serializeCodeBlock(node), indent)
    case 'horizontalRule':
      return indentLines('---', indent)
    case 'image': {
      const image: JSONContent = { type: 'image', attrs: node.attrs }
      return indentLines(serializeInline([image]), indent)
    }
    case 'rawBlock':
    case 'frontMatter':
    case 'linkReferenceDefinition':
      return indentLines(String(node.attrs?.raw ?? ''), indent)
    case 'table':
      return null
    default:
      return null
  }
}

export function serializeBlocks(nodes: JSONContent[], eol: string): string | null {
  const parts: string[] = []
  for (const node of nodes) {
    const block = serializeBlock(node)
    if (block === null) {
      return null
    }
    parts.push(block)
  }
  return parts.join(eol + eol)
}
