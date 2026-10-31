import type { SourceMap, SourceSpan } from './types.js'

export interface ProjectedMark {
  type: 'bold' | 'italic' | 'strike' | 'link' | 'code'
  attrs?: Record<string, unknown>
}

export interface ProjectedNode {
  type: string
  attrs?: Record<string, unknown>
  marks?: ProjectedMark[]
  text?: string
  content?: ProjectedNode[]
}

export interface ProjectedDocument extends ProjectedNode {
  type: 'doc'
}

export function projectDocument(map: SourceMap): ProjectedDocument {
  const content: ProjectedNode[] = []

  for (const root of map.roots) {
    const node = projectBlock(root)
    if (node) {
      content.push(node)
    }
  }

  return { type: 'doc', content }
}

function projectBlock(span: SourceSpan): ProjectedNode | null {
  if (
    span.kind === 'raw' &&
    span.tokenType !== 'front_matter' &&
    span.tokenType !== 'html' &&
    span.tokenType !== 'link_reference_definition'
  ) {
    return node(
      'rawBlock',
      {
        sourceId: span.id,
        tokenType: span.tokenType ?? 'raw',
        raw: span.raw,
      },
      [],
    )
  }

  switch (span.tokenType) {
    case 'paragraph':
      return node('paragraph', { sourceId: span.id }, projectInline(span))
    case 'heading':
      return node(
        'heading',
        {
          sourceId: span.id,
          level: span.attrs?.headingLevel ?? 1,
          headingStyle: span.attrs?.headingStyle ?? 'atx',
        },
        projectInline(span),
      )
    case 'list': {
      const items = childrenOf(span)
        .filter(child => child.tokenType === 'list_item')
        .map(item => projectBlock(item))
        .filter((child): child is ProjectedNode => child !== null)
      return node(
        span.attrs?.ordered ? 'orderedList' : 'bulletList',
        {
          sourceId: span.id,
          ...(span.attrs?.ordered && span.attrs.listStart !== undefined
            ? { start: span.attrs.listStart }
            : {}),
        },
        items,
      )
    }
    case 'list_item': {
      const content = childrenOf(span)
        .map(child => projectBlock(child))
        .filter((child): child is ProjectedNode => child !== null)
      return node(
        'listItem',
        {
          sourceId: span.id,
          ...(span.attrs?.task ? { checked: Boolean(span.attrs.checked) } : {}),
          ...(span.attrs?.marker ? { marker: span.attrs.marker } : {}),
        },
        content,
      )
    }
    case 'blockquote':
      return node(
        'blockquote',
        { sourceId: span.id },
        childrenOf(span)
          .map(child => projectBlock(child))
          .filter((child): child is ProjectedNode => child !== null),
      )
    case 'table': {
      const rows = childrenOf(span)
        .filter(child => child.tokenType === 'table_row')
        .map(row => projectTableRow(row))
        .filter((row): row is ProjectedNode => row !== null)
      return node('table', { sourceId: span.id }, rows)
    }
    case 'table_row':
      return projectTableRow(span)
    case 'code_block':
      return node('codeBlock', { sourceId: span.id, language: span.attrs?.lang ?? '' }, [
        { type: 'text', text: span.attrs?.value ?? '' },
      ])
    case 'thematic_break':
      return node('horizontalRule', { sourceId: span.id }, [])
    case 'front_matter':
      return node('frontMatter', { sourceId: span.id, raw: span.raw }, [])
    case 'html':
      return node('rawBlock', { sourceId: span.id, tokenType: span.tokenType, raw: span.raw }, [])
    case 'link_reference_definition':
      return node('linkReferenceDefinition', { sourceId: span.id, raw: span.raw }, [])
    default:
      if (span.kind === 'raw') {
        return node(
          'rawBlock',
          {
            sourceId: span.id,
            tokenType: span.tokenType ?? 'raw',
            raw: span.raw,
          },
          [],
        )
      }
      if (span.kind === 'gap') {
        return null
      }
      return null
  }
}

function projectTableRow(span: SourceSpan): ProjectedNode | null {
  const cells = childrenOf(span)
    .filter(child => child.tokenType === 'table_cell')
    .map(cell => {
      const inline = projectInline(cell)
      return node(
        cell.attrs?.header ? 'tableHeader' : 'tableCell',
        {
          sourceId: cell.id,
          align: cell.attrs?.cellAlign ?? null,
          colspan: 1,
          rowspan: 1,
        },
        inline.length > 0 ? [node('paragraph', { sourceId: cell.id }, inline)] : [],
      )
    })

  return node('tableRow', { sourceId: span.id }, cells)
}

function projectInline(span: SourceSpan): ProjectedNode[] {
  const result: ProjectedNode[] = []
  for (const child of childrenOf(span)) {
    result.push(...projectInlineSpan(child, []))
  }
  return result
}

function projectInlineSpan(span: SourceSpan, marks: ProjectedMark[]): ProjectedNode[] {
  switch (span.tokenType) {
    case 'text':
      return textNode(span, marks)
    case 'escape':
      return textNode(span, marks)
    case 'strong':
      return projectInlineWith(span, marks, { type: 'bold' })
    case 'emphasis':
      return projectInlineWith(span, marks, { type: 'italic' })
    case 'strikethrough':
      return projectInlineWith(span, marks, { type: 'strike' })
    case 'link':
      return projectInlineWith(span, marks, {
        type: 'link',
        attrs: {
          href: span.attrs?.href ?? '',
          ...(span.attrs?.title ? { title: span.attrs.title } : {}),
        },
      })
    case 'code':
      return [
        {
          type: 'text',
          text: span.attrs?.value ?? span.raw,
          marks: [...marks, { type: 'code' }],
          attrs: { sourceId: span.id },
        },
      ]
    case 'image':
      return [
        {
          type: 'image',
          attrs: {
            sourceId: span.id,
            src: span.attrs?.src ?? '',
            alt: span.attrs?.alt ?? '',
            ...(span.attrs?.title ? { title: span.attrs.title } : {}),
          },
        },
      ]
    case 'hard_break':
      return [{ type: 'hardBreak', attrs: { sourceId: span.id } }]
    case 'inline_html':
      return [
        {
          type: 'rawInline',
          attrs: { sourceId: span.id, raw: span.raw },
        },
      ]
    default:
      if (span.kind === 'gap') {
        return span.attrs?.lineBreak
          ? [{ type: 'text', text: '\n', marks: [...marks], attrs: { sourceId: span.id } }]
          : []
      }
      if (span.kind === 'raw') {
        return [
          {
            type: 'rawInline',
            attrs: { sourceId: span.id, tokenType: span.tokenType ?? 'raw', raw: span.raw },
          },
        ]
      }
      return []
  }
}

function projectInlineWith(
  span: SourceSpan,
  marks: ProjectedMark[],
  mark: ProjectedMark,
): ProjectedNode[] {
  const next = [...marks, mark]
  const result: ProjectedNode[] = []
  for (const child of childrenOf(span)) {
    result.push(...projectInlineSpan(child, next))
  }
  return result
}

function textNode(span: SourceSpan, marks: ProjectedMark[]): ProjectedNode[] {
  const text = span.attrs?.value ?? span.raw
  if (text.length === 0) {
    return []
  }

  return [
    {
      type: 'text',
      text,
      ...(marks.length > 0 ? { marks: marks.map(mark => ({ ...mark })) } : {}),
      attrs: { sourceId: span.id },
    },
  ]
}

function childrenOf(span: SourceSpan): SourceSpan[] {
  return span.children ?? []
}

function node(
  type: string,
  attrs: Record<string, unknown>,
  content: ProjectedNode[],
): ProjectedNode {
  return { type, attrs, content }
}
