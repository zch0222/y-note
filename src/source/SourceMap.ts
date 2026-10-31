import { fingerprint } from './hash.js'
import {
  lexDocument,
  type MarkdownCell,
  type MarkdownToken,
} from './lexer.js'
import type { SourceMap, SourceMapIssue, SourceSpan, SpanAttrs, SpanKind } from './types.js'
import {
  boundaryOf,
  rangeOf,
  sliceView,
  stripLines,
  viewForSource,
  type SourceView,
} from './views.js'

interface SpanInit {
  id: string
  kind: SpanKind
  start: number
  end: number
  contentStart: number
  contentEnd: number
  parentId?: string
  tokenType?: string
  attrs?: SpanAttrs
  children?: SourceSpan[]
}

interface ListPrefix {
  marker: string
  prefixLength: number
  contentIndent: number
  task: boolean
  checked: boolean
}

interface CellRange {
  from: number
  to: number
  contentFrom: number
  contentTo: number
}

const QUOTE_PREFIX = /^[ \t]{0,3}>[ \t]?/
const LIST_PREFIX = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+)(\[[ xX]\](?:[ \t]+|$))?/
const ATX_HEADING = /^( {0,3})(#{1,6})([ \t]+|$)/
const CLOSING_HASHES = /[ \t]+#+[ \t]*$/

function leadingWhitespace(line: string): number {
  let count = 0
  while (count < line.length && (line[count] === ' ' || line[count] === '\t')) {
    count += 1
  }
  return count
}

function parseListPrefix(line: string): ListPrefix | null {
  const match = LIST_PREFIX.exec(line)
  if (!match) {
    return null
  }

  const checkbox = match[4]
  return {
    marker: match[2]!,
    prefixLength: match[0].length,
    contentIndent: match[1]!.length + match[2]!.length + match[3]!.length,
    task: Boolean(checkbox),
    checked: checkbox ? /\[[xX]\]/.test(checkbox) : false,
  }
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashes += 1
  }
  return slashes % 2 === 1
}

function splitCellRanges(view: SourceView, from: number, to: number): CellRange[] {
  let start = from
  let end = to

  while (start < end && (view.text[start] === ' ' || view.text[start] === '\t')) {
    start += 1
  }
  while (end > start && (view.text[end - 1] === ' ' || view.text[end - 1] === '\t')) {
    end -= 1
  }

  if (view.text[start] === '|') {
    start += 1
  }
  if (end > start && view.text[end - 1] === '|') {
    end -= 1
  }

  const cells: CellRange[] = []
  let cellStart = start

  for (let index = start; index < end; index += 1) {
    if (view.text[index] !== '|' || isEscaped(view.text, index)) {
      continue
    }

    cells.push(makeCellRange(view, cellStart, index))
    cellStart = index + 1
  }
  cells.push(makeCellRange(view, cellStart, end))

  return cells
}

function makeCellRange(view: SourceView, from: number, to: number): CellRange {
  let contentFrom = from
  let contentTo = to

  while (contentFrom < contentTo && (view.text[contentFrom] === ' ' || view.text[contentFrom] === '\t')) {
    contentFrom += 1
  }
  while (contentTo > contentFrom && (view.text[contentTo - 1] === ' ' || view.text[contentTo - 1] === '\t')) {
    contentTo -= 1
  }

  return { from, to, contentFrom, contentTo }
}

function unescapeCellText(text: string): string {
  return text.replace(/\\\|/g, '|')
}

function splitLineRanges(view: SourceView, from: number, to: number): Array<{ from: number; to: number }> {
  const lines: Array<{ from: number; to: number }> = []
  let cursor = from

  while (cursor <= to) {
    const newline = view.text.indexOf('\n', cursor)
    const lineEnd = newline === -1 || newline > to ? to : newline
    lines.push({ from: cursor, to: lineEnd })
    if (newline === -1 || newline >= to) {
      break
    }
    cursor = newline + 1
  }

  return lines
}

function isFenceClose(line: string, fenceChar: string, fenceLength: number): boolean {
  const trimmed = line.replace(/^[ \t]{0,3}/, '')
  let run = 0
  while (trimmed[run] === fenceChar) {
    run += 1
  }
  if (run < fenceLength) {
    return false
  }
  return trimmed.slice(run).trim() === ''
}

class SpanBuilder {
  private readonly source: string
  private readonly view: SourceView
  private readonly lex
  private readonly issues: SourceMapIssue[]
  private rootId = 0
  private childCounters = new Map<string, number>()
  private gapCounters = new Map<string, number>()

  constructor(source: string) {
    this.source = source
    this.view = viewForSource(source)
    this.lex = lexDocument(source)
    this.issues = [...this.lex.issues]
  }

  build(): SourceMap {
    const roots: SourceSpan[] = []

    if (this.lex.frontMatter) {
      const range = rangeOf(this.view, this.lex.frontMatter.from, this.lex.frontMatter.to, 0)
      roots.push(
        this.createSpan({
          id: this.nextRootId(),
          kind: 'raw',
          start: range.start,
          end: range.end,
          contentStart: range.start,
          contentEnd: range.end,
          tokenType: 'front_matter',
          attrs: { value: this.source.slice(range.start, range.end) },
        }),
      )
    }

    for (const lexed of this.lex.tokens) {
      const range = rangeOf(this.view, lexed.from, lexed.to, 0)
      const previous = roots[roots.length - 1]
      const cursor = previous ? previous.end : 0

      if (range.start > cursor) {
        roots.push(this.gap(this.nextRootId(), cursor, range.start, undefined, 'space'))
      }

      roots.push(
        this.buildBlock(lexed.token, this.view, lexed.from, lexed.to, this.nextRootId()),
      )
    }

    const last = roots[roots.length - 1]
    const end = last ? last.end : 0
    if (end < this.source.length) {
      roots.push(this.gap(this.nextRootId(), end, this.source.length, undefined, 'trailing'))
    }

    const byId = new Map<string, SourceSpan>()
    const visit = (span: SourceSpan) => {
      if (byId.has(span.id)) {
        this.issues.push({
          code: 'duplicate-span-id',
          message: `Duplicate span id ${span.id}`,
          offset: span.start,
        })
      }
      byId.set(span.id, span)
      for (const child of span.children ?? []) {
        visit(child)
      }
    }
    for (const root of roots) {
      visit(root)
    }

    return { source: this.source, roots, byId, issues: this.issues }
  }

  private nextRootId(): string {
    const id = `s${this.rootId}`
    this.rootId += 1
    return id
  }

  private childId(parentId: string): string {
    const next = this.childCounters.get(parentId) ?? 0
    this.childCounters.set(parentId, next + 1)
    return `${parentId}.${next}`
  }

  private gapId(parentId: string): string {
    const next = this.gapCounters.get(parentId) ?? 0
    this.gapCounters.set(parentId, next + 1)
    return `${parentId}.gap${next}`
  }

  private createSpan(init: SpanInit): SourceSpan {
    const raw = this.source.slice(init.start, init.end)
    const contentStart = Math.max(init.start, Math.min(init.contentStart, init.end))
    const contentEnd = Math.max(contentStart, Math.min(init.contentEnd, init.end))

    return {
      id: init.id,
      kind: init.kind,
      start: init.start,
      end: init.end,
      contentStart,
      contentEnd,
      ...(init.parentId ? { parentId: init.parentId } : {}),
      raw,
      fingerprint: fingerprint(raw),
      ...(init.tokenType ? { tokenType: init.tokenType } : {}),
      prefixRaw: this.source.slice(init.start, contentStart),
      suffixRaw: this.source.slice(contentEnd, init.end),
      ...(init.attrs ? { attrs: init.attrs } : {}),
      ...(init.children ? { children: init.children } : {}),
    }
  }

  private gap(
    id: string,
    start: number,
    end: number,
    parentId: string | undefined,
    tokenType = 'gap',
  ): SourceSpan {
    const raw = this.source.slice(start, end)
    return this.createSpan({
      id,
      kind: 'gap',
      start,
      end,
      contentStart: start,
      contentEnd: end,
      ...(parentId ? { parentId } : {}),
      tokenType,
      ...(/[\r\n]/.test(raw) ? { attrs: { lineBreak: true } } : {}),
    })
  }

  private tile(
    parentId: string,
    children: SourceSpan[],
    contentStart: number,
    contentEnd: number,
  ): SourceSpan[] {
    const sorted = [...children].sort((left, right) => left.start - right.start)
    const result: SourceSpan[] = []
    let cursor = contentStart

    for (const child of sorted) {
      if (child.start < cursor) {
        this.issues.push({
          code: 'overlapping-child-span',
          message: `Span ${child.id} overlaps its previous sibling`,
          offset: child.start,
        })
        continue
      }
      if (child.start > cursor) {
        result.push(this.gap(this.gapId(parentId), cursor, child.start, parentId))
      }
      result.push(child)
      cursor = child.end
    }

    if (cursor < contentEnd) {
      result.push(this.gap(this.gapId(parentId), cursor, contentEnd, parentId))
    }

    return result
  }

  private rawSpan(
    token: MarkdownToken,
    view: SourceView,
    from: number,
    to: number,
    id: string,
    parentId: string | undefined,
    tokenType?: string,
  ): SourceSpan {
    const range = rangeOf(view, from, to, 0)
    return this.createSpan({
      id,
      kind: 'raw',
      start: range.start,
      end: range.end,
      contentStart: range.start,
      contentEnd: range.end,
      ...(parentId ? { parentId } : {}),
      tokenType: tokenType ?? token.type,
      attrs: { value: view.text.slice(from, to) },
    })
  }

  private buildBlock(
    token: MarkdownToken,
    view: SourceView,
    from: number,
    to: number,
    id: string,
    parentId?: string,
  ): SourceSpan {
    switch (token.type) {
      case 'paragraph':
      case 'text':
        return this.buildParagraph(token, view, from, to, id, parentId)
      case 'heading':
        return this.buildHeading(token, view, from, to, id, parentId)
      case 'list':
        return this.buildList(token, view, from, to, id, parentId)
      case 'blockquote':
        return this.buildBlockquote(token, view, from, to, id, parentId)
      case 'table':
        return this.buildTable(token, view, from, to, id, parentId)
      case 'code':
        return this.buildCode(token, view, from, to, id, parentId)
      case 'html':
        return this.rawSpan(token, view, from, to, id, parentId, 'html')
      case 'def':
        return this.rawSpan(token, view, from, to, id, parentId, 'link_reference_definition')
      case 'hr': {
        const range = rangeOf(view, from, to, 0)
        return this.createSpan({
          id,
          kind: 'delimiter',
          start: range.start,
          end: range.end,
          contentStart: range.start,
          contentEnd: range.end,
          ...(parentId ? { parentId } : {}),
          tokenType: 'thematic_break',
        })
      }
      case 'space': {
        const range = rangeOf(view, from, to, 0)
        return this.gap(id, range.start, range.end, parentId, 'space')
      }
      default:
        return this.rawSpan(token, view, from, to, id, parentId)
    }
  }

  private buildParagraph(
    token: MarkdownToken,
    view: SourceView,
    from: number,
    to: number,
    id: string,
    parentId?: string,
  ): SourceSpan {
    const raw = view.text.slice(from, to)
    const inlineTokens = token.tokens ?? []
    const inlineText = inlineTokens.map(child => child.raw ?? '').join('')
    const inlineAt = raw.indexOf(inlineText)

    if (inlineText.length === 0 || inlineAt === -1) {
      return this.rawSpan(token, view, from, to, id, parentId, 'paragraph')
    }

    const contentFrom = from + inlineAt
    const contentTo = contentFrom + inlineText.length
    const children = this.buildInline(inlineTokens, sliceView(view, contentFrom, contentTo), id)
    if (!children) {
      return this.rawSpan(token, view, from, to, id, parentId, 'paragraph')
    }

    const range = rangeOf(view, from, to, 0)
    const content = rangeOf(view, contentFrom, contentTo, range.start)
    return this.createSpan({
      id,
      kind: 'block',
      start: range.start,
      end: range.end,
      contentStart: content.start,
      contentEnd: content.end,
      ...(parentId ? { parentId } : {}),
      tokenType: 'paragraph',
      children: this.tile(id, children, content.start, content.end),
    })
  }

  private buildHeading(
    token: MarkdownToken,
    view: SourceView,
    from: number,
    to: number,
    id: string,
    parentId?: string,
  ): SourceSpan {
    const raw = view.text.slice(from, to)
    const firstLineEnd = raw.indexOf('\n')
    const firstLine = firstLineEnd === -1 ? raw : raw.slice(0, firstLineEnd)
    const atx = ATX_HEADING.exec(firstLine)
    const inlineTokens = token.tokens ?? []
    const inlineText = inlineTokens.map(child => child.raw ?? '').join('')

    let contentFrom: number
    let contentTo: number
    let style: 'atx' | 'setext'

    if (atx) {
      style = 'atx'
      contentFrom = from + atx[0].length
      contentTo = from + firstLine.length

      const closing = CLOSING_HASHES.exec(firstLine.slice(atx[0].length))
      if (closing) {
        contentTo = from + atx[0].length + closing.index
      }

      const contentText = view.text.slice(contentFrom, contentTo)
      const inlineAt = contentText.indexOf(inlineText)
      if (inlineText.length === 0) {
        contentTo = contentFrom
      } else if (inlineAt === -1) {
        return this.rawSpan(token, view, from, to, id, parentId, 'heading')
      } else {
        contentFrom += inlineAt
        contentTo = contentFrom + inlineText.length
      }
    } else {
      style = 'setext'
      contentFrom = from
      if (inlineText.length === 0) {
        contentTo = from
      } else {
        const inlineAt = raw.indexOf(inlineText)
        if (inlineAt === -1) {
          return this.rawSpan(token, view, from, to, id, parentId, 'heading')
        }
        contentFrom = from + inlineAt
        contentTo = contentFrom + inlineText.length
      }
    }

    const children =
      inlineText.length === 0
        ? []
        : this.buildInline(inlineTokens, sliceView(view, contentFrom, contentTo), id)
    if (!children) {
      return this.rawSpan(token, view, from, to, id, parentId, 'heading')
    }

    const range = rangeOf(view, from, to, 0)
    const content = rangeOf(view, contentFrom, contentTo, range.start)
    return this.createSpan({
      id,
      kind: 'block',
      start: range.start,
      end: range.end,
      contentStart: content.start,
      contentEnd: content.end,
      ...(parentId ? { parentId } : {}),
      tokenType: 'heading',
      attrs: {
        headingLevel: token.depth ?? 1,
        headingStyle: style,
      },
      children: this.tile(id, children, content.start, content.end),
    })
  }

  private buildList(
    token: MarkdownToken,
    view: SourceView,
    from: number,
    to: number,
    id: string,
    parentId?: string,
  ): SourceSpan {
    const raw = view.text.slice(from, to)
    const items = token.items ?? []
    const children: SourceSpan[] = []
    let cursor = 0

    for (const item of items) {
      const itemRaw = item.raw ?? ''
      const itemAt = raw.indexOf(itemRaw, cursor)
      if (itemAt === -1) {
        return this.rawSpan(token, view, from, to, id, parentId, 'list')
      }

      children.push(
        this.buildListItem(
          item,
          view,
          from + itemAt,
          from + itemAt + itemRaw.length,
          this.childId(id),
          id,
        ),
      )
      cursor = itemAt + itemRaw.length
    }

    const range = rangeOf(view, from, to, 0)
    return this.createSpan({
      id,
      kind: 'block',
      start: range.start,
      end: range.end,
      contentStart: range.start,
      contentEnd: range.end,
      ...(parentId ? { parentId } : {}),
      tokenType: 'list',
      attrs: {
        ordered: Boolean(token.ordered),
        ...(typeof token.start === 'number' ? { listStart: token.start } : {}),
      },
      children: this.tile(id, children, range.start, range.end),
    })
  }

  private buildListItem(
    item: MarkdownToken,
    view: SourceView,
    from: number,
    to: number,
    id: string,
    parentId: string,
  ): SourceSpan {
    const raw = view.text.slice(from, to)
    const firstLineEnd = raw.indexOf('\n')
    const firstLine = firstLineEnd === -1 ? raw : raw.slice(0, firstLineEnd)
    const prefix = parseListPrefix(firstLine)

    if (!prefix) {
      return this.rawSpan(item, view, from, to, id, parentId, 'list_item')
    }

    const stripped = stripLines(view, from, to, (line, lineIndex) => {
      if (lineIndex === 0) {
        return prefix.prefixLength
      }
      return Math.min(prefix.contentIndent, leadingWhitespace(line))
    })

    const inlineChildren = (item.tokens ?? []).filter(child => child.type !== 'checkbox')
    const children: SourceSpan[] = []
    let cursor = 0

    for (const child of inlineChildren) {
      const childRaw = child.raw ?? ''
      const childAt = stripped.text.indexOf(childRaw, cursor)
      if (childAt === -1) {
        return this.rawSpan(item, view, from, to, id, parentId, 'list_item')
      }
      children.push(
        this.buildBlock(child, stripped, childAt, childAt + childRaw.length, this.childId(id), id),
      )
      cursor = childAt + childRaw.length
    }

    const range = rangeOf(view, from, to, 0)
    const firstChild = children[0]
    const lastChild = children[children.length - 1]
    const contentStart = firstChild ? firstChild.start : boundaryOf(stripped, 0, range.start)
    const contentEnd = lastChild ? lastChild.end : contentStart

    return this.createSpan({
      id,
      kind: 'block',
      start: range.start,
      end: range.end,
      contentStart,
      contentEnd,
      parentId,
      tokenType: 'list_item',
      attrs: {
        marker: prefix.marker,
        task: prefix.task,
        checked: prefix.checked,
      },
      children: this.tile(id, children, contentStart, contentEnd),
    })
  }

  private buildBlockquote(
    token: MarkdownToken,
    view: SourceView,
    from: number,
    to: number,
    id: string,
    parentId?: string,
  ): SourceSpan {
    const stripped = stripLines(view, from, to, line => {
      const match = QUOTE_PREFIX.exec(line)
      return match ? match[0].length : 0
    })

    const quoteChildren = token.tokens ?? []
    const children: SourceSpan[] = []
    let cursor = 0

    for (const child of quoteChildren) {
      const childRaw = child.raw ?? ''
      const childAt = stripped.text.indexOf(childRaw, cursor)
      if (childAt === -1) {
        return this.rawSpan(token, view, from, to, id, parentId, 'blockquote')
      }
      children.push(
        this.buildBlock(child, stripped, childAt, childAt + childRaw.length, this.childId(id), id),
      )
      cursor = childAt + childRaw.length
    }

    const range = rangeOf(view, from, to, 0)
    const firstChild = children[0]
    const lastChild = children[children.length - 1]
    const contentStart = firstChild ? firstChild.start : range.start
    const contentEnd = lastChild ? lastChild.end : contentStart

    return this.createSpan({
      id,
      kind: 'block',
      start: range.start,
      end: range.end,
      contentStart,
      contentEnd,
      ...(parentId ? { parentId } : {}),
      tokenType: 'blockquote',
      children: this.tile(id, children, contentStart, contentEnd),
    })
  }

  private buildTable(
    token: MarkdownToken,
    view: SourceView,
    from: number,
    to: number,
    id: string,
    parentId?: string,
  ): SourceSpan {
    const fallback = () => {
      this.issues.push({
        code: 'table-degraded',
        message: 'Table cells could not be mapped without ambiguity; block kept as raw',
        offset: rangeOf(view, from, to, 0).start,
      })
      return this.rawSpan(token, view, from, to, id, parentId, 'table')
    }

    const lines = splitLineRanges(view, from, to)
    while (lines.length > 0 && lines[lines.length - 1]!.from === lines[lines.length - 1]!.to) {
      lines.pop()
    }

    if (lines.length < 2) {
      return fallback()
    }

    const headerCells = splitCellRanges(view, lines[0]!.from, lines[0]!.to)
    const delimiterCells = splitCellRanges(view, lines[1]!.from, lines[1]!.to)
    const header = token.header ?? []
    const rows = token.rows ?? []

    if (
      headerCells.length !== delimiterCells.length ||
      headerCells.length !== header.length ||
      headerCells.length === 0
    ) {
      return fallback()
    }

    const align: Array<'left' | 'right' | 'center' | null> = []

    for (const cell of delimiterCells) {
      const text = view.text.slice(cell.contentFrom, cell.contentTo)
      if (!/^:?-+:?$/.test(text)) {
        return fallback()
      }
      const left = text.startsWith(':')
      const right = text.endsWith(':')
      align.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null)
    }

    const headerRow = this.buildTableRow(
      header,
      view,
      lines[0]!,
      this.childId(id),
      id,
      true,
      0,
      align,
    )
    if (!headerRow) {
      return fallback()
    }

    const delimiterRange = rangeOf(view, lines[1]!.from, lines[1]!.to, 0)
    const delimiterSpan = this.createSpan({
      id: this.childId(id),
      kind: 'delimiter',
      start: delimiterRange.start,
      end: delimiterRange.end,
      contentStart: delimiterRange.start,
      contentEnd: delimiterRange.end,
      parentId: id,
      tokenType: 'table_delimiter',
      attrs: { align },
    })

    const rowSpans: SourceSpan[] = [headerRow, delimiterSpan]

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const line = lines[rowIndex + 2]
      if (!line) {
        return fallback()
      }
      const row = this.buildTableRow(
        rows[rowIndex] ?? [],
        view,
        line,
        this.childId(id),
        id,
        false,
        rowIndex + 1,
        align,
      )
      if (!row) {
        return fallback()
      }
      rowSpans.push(row)
    }

    const range = rangeOf(view, from, to, 0)
    return this.createSpan({
      id,
      kind: 'block',
      start: range.start,
      end: range.end,
      contentStart: range.start,
      contentEnd: range.end,
      ...(parentId ? { parentId } : {}),
      tokenType: 'table',
      attrs: { align },
      children: this.tile(id, rowSpans, range.start, range.end),
    })
  }

  private buildTableRow(
    cells: MarkdownCell[],
    view: SourceView,
    line: { from: number; to: number },
    id: string,
    parentId: string,
    header: boolean,
    row: number,
    align: Array<'left' | 'right' | 'center' | null>,
  ): SourceSpan | null {
    const ranges = splitCellRanges(view, line.from, line.to)
    if (ranges.length !== cells.length || ranges.length === 0) {
      return null
    }

    const children: SourceSpan[] = []

    for (let column = 0; column < ranges.length; column += 1) {
      const range = ranges[column]!
      const cell = cells[column]!
      const contentText = view.text.slice(range.contentFrom, range.contentTo)

      if (unescapeCellText(contentText) !== cell.text) {
        return null
      }

      const cellFrom = range.contentFrom
      const cellTo = range.contentTo
      const inlineTokens = cell.tokens ?? []
      const inlineText = inlineTokens.map(child => child.raw ?? '').join('')
      let contentFrom = cellFrom
      let contentTo = cellTo

      if (inlineText.length > 0) {
        if (contentText.indexOf(inlineText) === -1) {
          return null
        }
        contentFrom = cellFrom + contentText.indexOf(inlineText)
        contentTo = contentFrom + inlineText.length
      } else if (contentText.length > 0) {
        return null
      }

      const abs = rangeOf(view, range.from, range.to, 0)
      const content = rangeOf(view, contentFrom, contentTo, abs.start)
      const cellId = this.childId(id)

      let inlineChildren: SourceSpan[] = []
      if (inlineTokens.length > 0) {
        const built = this.buildInline(inlineTokens, sliceView(view, contentFrom, contentTo), cellId)
        if (!built) {
          return null
        }
        inlineChildren = built
      }

      children.push(
        this.createSpan({
          id: cellId,
          kind: 'block',
          start: abs.start,
          end: abs.end,
          contentStart: content.start,
          contentEnd: content.end,
          parentId: id,
          tokenType: 'table_cell',
          attrs: {
            header,
            row,
            column,
            cellAlign: align[column] ?? null,
            value: cell.text,
          },
          children: this.tile(cellId, inlineChildren, content.start, content.end),
        }),
      )
    }

    const abs = rangeOf(view, line.from, line.to, 0)
    return this.createSpan({
      id,
      kind: 'block',
      start: abs.start,
      end: abs.end,
      contentStart: abs.start,
      contentEnd: abs.end,
      parentId,
      tokenType: 'table_row',
      attrs: { header, row },
      children: this.tile(id, children, abs.start, abs.end),
    })
  }

  private buildCode(
    token: MarkdownToken,
    view: SourceView,
    from: number,
    to: number,
    id: string,
    parentId?: string,
  ): SourceSpan {
    const raw = view.text.slice(from, to)
    const firstLineEnd = raw.indexOf('\n')
    const firstLine = firstLineEnd === -1 ? raw : raw.slice(0, firstLineEnd)
    const opening = /^([ \t]*)(`{3,}|~{3,})/.exec(firstLine)

    if (!opening || firstLineEnd === -1) {
      const range = rangeOf(view, from, to, 0)
      return this.createSpan({
        id,
        kind: 'block',
        start: range.start,
        end: range.end,
        contentStart: range.start,
        contentEnd: range.end,
        ...(parentId ? { parentId } : {}),
        tokenType: 'code_block',
        attrs: { value: token.text ?? '' },
      })
    }

    const fence = opening[2]!
    const fenceChar = fence[0]!
    let contentFrom = from + firstLineEnd + 1
    let closingFrom = to
    let cursor = contentFrom

    while (cursor <= to) {
      const newline = view.text.indexOf('\n', cursor)
      const lineEnd = newline === -1 || newline > to ? to : newline
      if (isFenceClose(view.text.slice(cursor, lineEnd), fenceChar, fence.length)) {
        closingFrom = cursor
        break
      }
      if (newline === -1 || newline >= to) {
        break
      }
      cursor = newline + 1
    }

    const range = rangeOf(view, from, to, 0)
    const contentStart = rangeOf(view, contentFrom, closingFrom, range.start)
    return this.createSpan({
      id,
      kind: 'block',
      start: range.start,
      end: range.end,
      contentStart: contentStart.start,
      contentEnd: contentStart.end,
      ...(parentId ? { parentId } : {}),
      tokenType: 'code_block',
      attrs: {
        value: token.text ?? '',
        lang: token.lang ?? '',
        fence,
      },
    })
  }

  private buildInline(
    tokens: MarkdownToken[],
    view: SourceView,
    parentId: string,
  ): SourceSpan[] | null {
    const children: SourceSpan[] = []
    let cursor = 0

    for (const token of tokens) {
      const raw = token.raw ?? ''
      if (raw.length === 0) {
        continue
      }

      const at = view.text.indexOf(raw, cursor)
      if (at === -1) {
        this.issues.push({
          code: 'inline-token-not-locatable',
          message: `Could not locate inline token ${token.type}`,
          offset: boundaryOf(view, 0, 0),
        })
        return null
      }

      const built = this.buildInlineToken(token, view, at, at + raw.length, parentId)
      if (!built) {
        return null
      }
      children.push(...built)
      cursor = at + raw.length
    }

    return children
  }

  private buildInlineToken(
    token: MarkdownToken,
    view: SourceView,
    from: number,
    to: number,
    parentId: string,
  ): SourceSpan[] | null {
    const id = this.childId(parentId)

    switch (token.type) {
      case 'text': {
        const spans: SourceSpan[] = []
        let segmentStart = from

        for (let index = from; index <= to; index += 1) {
          if (index === to || view.text[index] === '\n') {
            if (index > segmentStart) {
              const segmentId = index === to && segmentStart === from ? id : this.childId(parentId)
              const range = rangeOf(view, segmentStart, index, boundaryOf(view, from, 0))
              spans.push(
                this.createSpan({
                  id: segmentId,
                  kind: 'inline',
                  start: range.start,
                  end: range.end,
                  contentStart: range.start,
                  contentEnd: range.end,
                  parentId,
                  tokenType: 'text',
                  attrs: { value: view.text.slice(segmentStart, index) },
                }),
              )
            }
            segmentStart = index + 1
          }
        }

        return spans
      }
      case 'strong':
      case 'em':
      case 'del':
      case 'link': {
        const anchor = (token.tokens ?? []).map(child => child.raw ?? '').join('')
        const anchorAt = anchor.length > 0 ? view.text.indexOf(anchor, from) : -1
        if (anchorAt === -1 || anchorAt + anchor.length > to) {
          return [this.inlineRaw(token, view, from, to, id, parentId)]
        }

        const contentFrom = anchorAt
        const contentTo = anchorAt + anchor.length
        const inlineChildren = this.buildInline(
          token.tokens ?? [],
          sliceView(view, contentFrom, contentTo),
          id,
        )
        if (!inlineChildren) {
          return null
        }

        const range = rangeOf(view, from, to, 0)
        const content = rangeOf(view, contentFrom, contentTo, range.start)
        const tokenType =
          token.type === 'em' ? 'emphasis' : token.type === 'del' ? 'strikethrough' : token.type
        const attrs: SpanAttrs = {}
        if (token.type === 'link') {
          attrs.href = token.href ?? ''
          attrs.title = token.title ?? ''
        }

        return [
          this.createSpan({
            id,
            kind: 'inline',
            start: range.start,
            end: range.end,
            contentStart: content.start,
            contentEnd: content.end,
            parentId,
            tokenType,
            attrs,
            children: this.tile(id, inlineChildren, content.start, content.end),
          }),
        ]
      }
      case 'codespan': {
        const text = token.text ?? ''
        const textAt = text.length > 0 ? view.text.indexOf(text, from) : -1
        const range = rangeOf(view, from, to, 0)
        const content =
          textAt === -1 ? range : rangeOf(view, textAt, textAt + text.length, range.start)
        return [
          this.createSpan({
            id,
            kind: 'inline',
            start: range.start,
            end: range.end,
            contentStart: content.start,
            contentEnd: content.end,
            parentId,
            tokenType: 'code',
            attrs: { value: token.text ?? '' },
          }),
        ]
      }
      case 'escape': {
        const range = rangeOf(view, from, to, 0)
        const contentStart = Math.min(range.start + 1, range.end)
        return [
          this.createSpan({
            id,
            kind: 'inline',
            start: range.start,
            end: range.end,
            contentStart,
            contentEnd: range.end,
            parentId,
            tokenType: 'escape',
            attrs: { value: token.text ?? '' },
          }),
        ]
      }
      case 'image': {
        const range = rangeOf(view, from, to, 0)
        return [
          this.createSpan({
            id,
            kind: 'inline',
            start: range.start,
            end: range.end,
            contentStart: range.start,
            contentEnd: range.end,
            parentId,
            tokenType: 'image',
            attrs: {
              value: token.text ?? '',
              alt: token.text ?? '',
              src: token.href ?? '',
              title: token.title ?? '',
            },
          }),
        ]
      }
      case 'br': {
        const range = rangeOf(view, from, to, 0)
        return [
          this.createSpan({
            id,
            kind: 'delimiter',
            start: range.start,
            end: range.end,
            contentStart: range.start,
            contentEnd: range.end,
            parentId,
            tokenType: 'hard_break',
            attrs: { value: '\n' },
          }),
        ]
      }
      case 'html':
        return [this.inlineRaw(token, view, from, to, id, parentId, 'inline_html')]
      default:
        return [this.inlineRaw(token, view, from, to, id, parentId)]
    }
  }

  private inlineRaw(
    token: MarkdownToken,
    view: SourceView,
    from: number,
    to: number,
    id: string,
    parentId: string,
    tokenType?: string,
  ): SourceSpan {
    const range = rangeOf(view, from, to, 0)
    return this.createSpan({
      id,
      kind: 'raw',
      start: range.start,
      end: range.end,
      contentStart: range.start,
      contentEnd: range.end,
      parentId,
      tokenType: tokenType ?? token.type,
      attrs: { value: token.text ?? view.text.slice(from, to) },
    })
  }
}

export function buildSourceMap(source: string): SourceMap {
  return new SpanBuilder(source).build()
}

export function* walkSpans(roots: SourceSpan[]): Generator<SourceSpan> {
  function* walk(span: SourceSpan): Generator<SourceSpan> {
    yield span
    for (const child of span.children ?? []) {
      yield* walk(child)
    }
  }

  for (const root of roots) {
    yield* walk(root)
  }
}

export function reconstructSource(map: SourceMap): string {
  return map.roots.map(root => root.raw).join('')
}

export function validateSourceMap(map: SourceMap): SourceMapIssue[] {
  const issues: SourceMapIssue[] = []
  const ids = new Set<string>()

  let cursor = 0
  for (const root of map.roots) {
    if (root.start !== cursor) {
      issues.push({
        code: 'root-gap-or-overlap',
        message: `Root ${root.id} starts at ${root.start}, expected ${cursor}`,
        offset: root.start,
      })
    }
    cursor = root.end
  }
  if (cursor !== map.source.length) {
    issues.push({
      code: 'root-coverage',
      message: `Roots cover ${cursor} of ${map.source.length} characters`,
      offset: cursor,
    })
  }

  const visit = (span: SourceSpan, parent: SourceSpan | undefined) => {
    if (ids.has(span.id)) {
      issues.push({ code: 'duplicate-id', message: `Duplicate span id ${span.id}`, offset: span.start })
    }
    ids.add(span.id)

    if (span.start < 0 || span.end < span.start || span.end > map.source.length) {
      issues.push({ code: 'bounds', message: `Span ${span.id} has invalid bounds`, offset: span.start })
    }

    if (span.contentStart < span.start || span.contentEnd < span.contentStart || span.contentEnd > span.end) {
      issues.push({
        code: 'content-bounds',
        message: `Span ${span.id} has invalid content bounds`,
        offset: span.start,
      })
    }

    const slice = map.source.slice(span.start, span.end)
    if (slice !== span.raw) {
      issues.push({ code: 'raw-mismatch', message: `Span ${span.id} raw is not a source slice`, offset: span.start })
    }
    if (fingerprint(slice) !== span.fingerprint) {
      issues.push({ code: 'fingerprint', message: `Span ${span.id} fingerprint mismatch`, offset: span.start })
    }
    if (parent && (span.start < parent.start || span.end > parent.end)) {
      issues.push({ code: 'child-bounds', message: `Span ${span.id} escapes its parent`, offset: span.start })
    }
    if (parent && span.parentId !== parent.id) {
      issues.push({ code: 'parent-id', message: `Span ${span.id} parentId mismatch`, offset: span.start })
    }

    let childCursor: number | undefined
    for (const child of span.children ?? []) {
      if (childCursor !== undefined && child.start < childCursor) {
        issues.push({
          code: 'child-overlap',
          message: `Span ${child.id} overlaps its previous sibling`,
          offset: child.start,
        })
      }
      childCursor = child.end
      visit(child, span)
    }
  }

  for (const root of map.roots) {
    visit(root, undefined)
  }

  if (map.byId.size !== ids.size) {
    for (const id of ids) {
      if (!map.byId.has(id)) {
        issues.push({ code: 'index-missing', message: `Span ${id} missing from index` })
      }
    }
  }

  return issues
}

export function findSpanById(map: SourceMap, id: string): SourceSpan | undefined {
  return map.byId.get(id)
}

export function topLevelSpanAt(map: SourceMap, offset: number): SourceSpan | undefined {
  return map.roots.find(root => offset >= root.start && offset < root.end) ?? map.roots[map.roots.length - 1]
}

export function innermostSpanAt(map: SourceMap, offset: number): SourceSpan | undefined {
  const root = topLevelSpanAt(map, offset)
  if (!root) {
    return undefined
  }

  let current = root
  let found = true
  while (found) {
    found = false
    for (const child of current.children ?? []) {
      if (offset >= child.start && offset < child.end) {
        current = child
        found = true
        break
      }
    }
  }

  return current
}
