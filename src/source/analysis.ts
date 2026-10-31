import { buildSourceMap } from './SourceMap.js'
import type { SourceMap, SourceSpan } from './types.js'

export type DiffRowKind = 'context' | 'added' | 'removed' | 'gap'

export interface DiffRow {
  kind: DiffRowKind
  text: string
  before?: number
  after?: number
}

export interface DiffPreview {
  rows: DiffRow[]
  added: number
  removed: number
  changed: boolean
  truncated: boolean
}

export type BlockChangeKind = 'added' | 'removed' | 'modified'
export type ChangeClassification = 'content' | 'format'

export interface BlockChange {
  kind: BlockChangeKind
  classification: ChangeClassification
  tokenType: string
  label: string
  summary: string
  detail: string
  oldLine: number | null
  newLine: number | null
}

export interface BlockAnalysis {
  changes: BlockChange[]
  contentChanges: number
  formatChanges: number
  untouched: number
  oldBlocks: number
  newBlocks: number
  truncated: boolean
}

export interface SourceAnalysis {
  preview: DiffPreview
  blocks: BlockAnalysis
}

const CONTEXT_LINES = 3
const MAX_MIDDLE_LINES = 60
const MAX_BLOCK_CHANGES = 200
const MAX_SUMMARY_CHARS = 88

const TOKEN_LABELS: Record<string, string> = {
  paragraph: '段落',
  heading: '标题',
  list: '列表',
  list_item: '列表项',
  blockquote: '引用',
  table: '表格',
  table_row: '表格行',
  table_cell: '单元格',
  code_block: '代码块',
  thematic_break: '分隔线',
  html: 'HTML 块',
  front_matter: 'front matter',
  link_reference_definition: '引用定义',
  raw: '原始块',
  text: '文本',
  escape: '文本',
  strong: '粗体',
  emphasis: '斜体',
  strikethrough: '删除线',
  link: '链接',
  code: '行内代码',
  image: '图片',
  hard_break: '换行',
}

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return []
  }
  return text.split(/\r\n|\n|\r/)
}

function lineStartsOf(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\n') {
      starts.push(index + 1)
    } else if (char === '\r' && text[index + 1] !== '\n') {
      starts.push(index + 1)
    }
  }
  return starts
}

function lineAt(starts: number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if ((starts[middle] ?? 0) <= offset) {
      low = middle
    } else {
      high = middle - 1
    }
  }
  return low + 1
}

function shortText(text: string, limit = MAX_SUMMARY_CHARS): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= limit) {
    return collapsed
  }
  return `${collapsed.slice(0, limit - 1)}…`
}

function labelOf(span: SourceSpan): string {
  const tokenType = span.tokenType ?? (span.kind === 'gap' ? 'gap' : 'raw')
  return TOKEN_LABELS[tokenType] ?? tokenType
}

function childrenText(span: SourceSpan, separator = ''): string {
  return (span.children ?? []).map(child => visibleText(child)).join(separator)
}

function visibleText(span: SourceSpan): string {
  switch (span.tokenType) {
    case 'text':
    case 'escape':
    case 'code':
      return String(span.attrs?.value ?? span.raw)
    case 'image':
      return String(span.attrs?.alt ?? '')
    case 'hard_break':
      return '\n'
    case 'code_block':
      return String(span.attrs?.value ?? '')
    case 'thematic_break':
    case 'table_delimiter':
      return ''
    case 'front_matter':
    case 'link_reference_definition':
    case 'html':
      return span.raw
    case 'table_row':
    case 'table':
      return childrenText(span, ' | ')
    case 'list':
    case 'list_item':
      return childrenText(span, ' ')
    default:
      if (span.kind === 'gap') {
        return span.attrs?.lineBreak ? '\n' : ''
      }
      if (span.children && span.children.length > 0) {
        return childrenText(span)
      }
      return String(span.attrs?.value ?? span.raw)
  }
}

function contentMetaOf(span: SourceSpan): string {
  const parts: unknown[] = []
  const walk = (current: SourceSpan): void => {
    const attrs = current.attrs ?? {}
    if (current.tokenType === 'list_item' && attrs.task) {
      parts.push(['task', Boolean(attrs.checked)])
    }
    if (current.tokenType === 'link') {
      parts.push(['link', attrs.href ?? '', attrs.title ?? ''])
    }
    if (current.tokenType === 'image') {
      parts.push(['image', attrs.src ?? '', attrs.alt ?? ''])
    }
    for (const child of current.children ?? []) {
      walk(child)
    }
  }
  walk(span)
  return JSON.stringify(parts)
}

function formatMetaOf(span: SourceSpan): string {
  const parts: unknown[] = []
  const walk = (current: SourceSpan): void => {
    const attrs = current.attrs ?? {}
    if (current.tokenType === 'heading') {
      parts.push(['heading', attrs.headingLevel ?? null, attrs.headingStyle ?? null])
    }
    if (current.tokenType === 'list') {
      parts.push(['list', attrs.ordered ?? null, attrs.listStart ?? null])
    }
    if (current.tokenType === 'code_block') {
      parts.push(['code', attrs.lang ?? ''])
    }
    if (current.tokenType === 'table') {
      parts.push(['table', attrs.align ?? null])
    }
    if (current.tokenType === 'table_cell') {
      parts.push(['cell', attrs.cellAlign ?? null])
    }
    for (const child of current.children ?? []) {
      walk(child)
    }
  }
  walk(span)
  return JSON.stringify(parts)
}

function firstTaskState(span: SourceSpan): boolean | null {
  if (span.tokenType === 'list_item' && span.attrs?.task) {
    return Boolean(span.attrs.checked)
  }
  for (const child of span.children ?? []) {
    const value = firstTaskState(child)
    if (value !== null) {
      return value
    }
  }
  return null
}

function firstLinkTarget(span: SourceSpan): string | null {
  if (span.tokenType === 'link') {
    return String(span.attrs?.href ?? '')
  }
  for (const child of span.children ?? []) {
    const value = firstLinkTarget(child)
    if (value !== null) {
      return value
    }
  }
  return null
}

interface AnalyzedBlock {
  span: SourceSpan
  key: string
  text: string
  label: string
  line: number
}

function blocksOf(map: SourceMap): AnalyzedBlock[] {
  const starts = lineStartsOf(map.source)
  const blocks: AnalyzedBlock[] = []
  for (const span of map.roots) {
    if (span.kind === 'gap') {
      continue
    }
    blocks.push({
      span,
      key: `${span.tokenType ?? span.kind}\u0000${span.raw.replace(/[\r\n]+$/, '')}`,
      text: visibleText(span),
      label: labelOf(span),
      line: lineAt(starts, span.start),
    })
  }
  return blocks
}

interface ChangedRegion {
  oldStart: number
  oldEnd: number
  newStart: number
  newEnd: number
}

function longestIncreasing(pairs: Array<[number, number]>): Array<[number, number]> {
  if (pairs.length === 0) {
    return []
  }

  const tails: number[] = []
  const previous = new Array<number>(pairs.length).fill(-1)

  for (let index = 0; index < pairs.length; index += 1) {
    const value = pairs[index]![1]
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (pairs[tails[middle]!]![1] < value) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    if (low > 0) {
      previous[index] = tails[low - 1]!
    }
    tails[low] = index
  }

  const result: Array<[number, number]> = []
  let cursor = tails[tails.length - 1] ?? -1
  while (cursor >= 0) {
    result.push(pairs[cursor]!)
    cursor = previous[cursor] ?? -1
  }
  return result.reverse()
}

function uniqueAnchors(
  left: string[],
  right: string[],
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): Array<[number, number]> {
  const leftCounts = new Map<string, { count: number; index: number }>()
  for (let index = leftStart; index < leftEnd; index += 1) {
    const key = left[index]!
    const entry = leftCounts.get(key)
    if (entry) {
      entry.count += 1
    } else {
      leftCounts.set(key, { count: 1, index })
    }
  }

  const rightCounts = new Map<string, number>()
  for (let index = rightStart; index < rightEnd; index += 1) {
    const key = right[index]!
    rightCounts.set(key, (rightCounts.get(key) ?? 0) + 1)
  }

  const pairs: Array<[number, number]> = []
  for (let index = rightStart; index < rightEnd; index += 1) {
    const key = right[index]!
    if (rightCounts.get(key) !== 1) {
      continue
    }
    const entry = leftCounts.get(key)
    if (!entry || entry.count !== 1) {
      continue
    }
    pairs.push([entry.index, index])
  }

  pairs.sort((leftPair, rightPair) => leftPair[0] - rightPair[0])
  return longestIncreasing(pairs)
}

function changedRegions(left: string[], right: string[]): ChangedRegion[] {
  const regions: ChangedRegion[] = []

  const walk = (
    leftStart: number,
    leftEnd: number,
    rightStart: number,
    rightEnd: number,
    depth: number,
  ): void => {
    while (
      leftStart < leftEnd &&
      rightStart < rightEnd &&
      left[leftStart] === right[rightStart]
    ) {
      leftStart += 1
      rightStart += 1
    }
    while (
      leftEnd > leftStart &&
      rightEnd > rightStart &&
      left[leftEnd - 1] === right[rightEnd - 1]
    ) {
      leftEnd -= 1
      rightEnd -= 1
    }

    if (leftStart === leftEnd && rightStart === rightEnd) {
      return
    }
    if (leftStart === leftEnd || rightStart === rightEnd || depth > 48) {
      regions.push({ oldStart: leftStart, oldEnd: leftEnd, newStart: rightStart, newEnd: rightEnd })
      return
    }

    const anchors = uniqueAnchors(left, right, leftStart, leftEnd, rightStart, rightEnd)
    if (anchors.length === 0) {
      regions.push({ oldStart: leftStart, oldEnd: leftEnd, newStart: rightStart, newEnd: rightEnd })
      return
    }

    let leftCursor = leftStart
    let rightCursor = rightStart
    for (const [anchorLeft, anchorRight] of anchors) {
      walk(leftCursor, anchorLeft, rightCursor, anchorRight, depth + 1)
      leftCursor = anchorLeft + 1
      rightCursor = anchorRight + 1
    }
    walk(leftCursor, leftEnd, rightCursor, rightEnd, depth + 1)
  }

  walk(0, left.length, 0, right.length, 0)

  const merged: ChangedRegion[] = []
  for (const region of regions) {
    const previous = merged[merged.length - 1]
    if (
      previous &&
      previous.oldEnd === region.oldStart &&
      previous.newEnd === region.newStart
    ) {
      previous.oldEnd = region.oldEnd
      previous.newEnd = region.newEnd
    } else {
      merged.push({ ...region })
    }
  }
  return merged
}

function headingLevel(span: SourceSpan): number | null {
  if (span.tokenType !== 'heading') {
    return null
  }
  const level = span.attrs?.headingLevel
  return typeof level === 'number' ? level : null
}

function formatDetail(before: AnalyzedBlock, after: AnalyzedBlock): string {
  if (before.span.tokenType !== after.span.tokenType) {
    return `块类型：${before.label} → ${after.label}`
  }

  const beforeLevel = headingLevel(before.span)
  const afterLevel = headingLevel(after.span)
  if (beforeLevel !== null && afterLevel !== null && beforeLevel !== afterLevel) {
    return `标题级别：H${beforeLevel} → H${afterLevel}`
  }

  if (before.span.tokenType === 'list') {
    const beforeOrdered = Boolean(before.span.attrs?.ordered)
    const afterOrdered = Boolean(after.span.attrs?.ordered)
    if (beforeOrdered !== afterOrdered) {
      return `列表类型：${beforeOrdered ? '有序' : '无序'} → ${afterOrdered ? '有序' : '无序'}`
    }
  }

  if (before.span.tokenType === 'code_block') {
    const beforeLang = String(before.span.attrs?.lang ?? '')
    const afterLang = String(after.span.attrs?.lang ?? '')
    if (beforeLang !== afterLang) {
      return `代码语言：${beforeLang || '无'} → ${afterLang || '无'}`
    }
  }

  return '仅 Markdown 标记或空白变化'
}

function contentDetail(before: AnalyzedBlock, after: AnalyzedBlock): string {
  if (before.text !== after.text) {
    const previous = shortText(before.text) || '（空）'
    const next = shortText(after.text) || '（空）'
    return `${previous} → ${next}`
  }

  const previousTask = firstTaskState(before.span)
  const nextTask = firstTaskState(after.span)
  if (previousTask !== null && nextTask !== null && previousTask !== nextTask) {
    return `任务状态：${previousTask ? '已完成' : '未完成'} → ${nextTask ? '已完成' : '未完成'}`
  }

  const previousHref = firstLinkTarget(before.span)
  const nextHref = firstLinkTarget(after.span)
  if (previousHref !== null && nextHref !== null && previousHref !== nextHref) {
    return '链接地址变化'
  }
  if (previousHref !== null || nextHref !== null) {
    return '链接标题变化'
  }
  if (before.span.tokenType === 'image' || after.span.tokenType === 'image') {
    return '图片地址或替代文本变化'
  }
  return '块内容变化'
}

function describeModified(before: AnalyzedBlock, after: AnalyzedBlock): BlockChange | null {
  if (before.span.raw === after.span.raw && before.span.tokenType === after.span.tokenType) {
    return null
  }

  const textChanged = before.text !== after.text
  const metaChanged = contentMetaOf(before.span) !== contentMetaOf(after.span)
  const classification: ChangeClassification = textChanged || metaChanged ? 'content' : 'format'
  const summary = shortText(after.text || after.span.raw)

  return {
    kind: 'modified',
    classification,
    tokenType: after.span.tokenType ?? 'raw',
    label: `${before.label}${before.label === after.label ? '' : ` → ${after.label}`}`,
    summary,
    detail:
      classification === 'content'
        ? contentDetail(before, after)
        : formatDetail(before, after),
    oldLine: before.line,
    newLine: after.line,
  }
}

function describeAdded(block: AnalyzedBlock): BlockChange {
  return {
    kind: 'added',
    classification: 'content',
    tokenType: block.span.tokenType ?? 'raw',
    label: block.label,
    summary: shortText(block.text || block.span.raw),
    detail: '新增块',
    oldLine: null,
    newLine: block.line,
  }
}

function describeRemoved(block: AnalyzedBlock): BlockChange {
  return {
    kind: 'removed',
    classification: 'content',
    tokenType: block.span.tokenType ?? 'raw',
    label: block.label,
    summary: shortText(block.text || block.span.raw),
    detail: '移除块',
    oldLine: block.line,
    newLine: null,
  }
}

export function analyzeBlockChanges(before: string, after: string): BlockAnalysis {
  if (before === after) {
    return {
      changes: [],
      contentChanges: 0,
      formatChanges: 0,
      untouched: 0,
      oldBlocks: 0,
      newBlocks: 0,
      truncated: false,
    }
  }

  const oldBlocks = blocksOf(buildSourceMap(before))
  const newBlocks = blocksOf(buildSourceMap(after))
  const regions = changedRegions(
    oldBlocks.map(block => block.key),
    newBlocks.map(block => block.key),
  )

  const changes: BlockChange[] = []
  let contentChanges = 0
  let formatChanges = 0
  let consumedOld = 0
  let truncated = false

  const push = (change: BlockChange | null) => {
    if (!change) {
      return
    }
    if (change.classification === 'content') {
      contentChanges += 1
    } else {
      formatChanges += 1
    }
    if (changes.length < MAX_BLOCK_CHANGES) {
      changes.push(change)
    } else {
      truncated = true
    }
  }

  for (const region of regions) {
    const oldSlice = oldBlocks.slice(region.oldStart, region.oldEnd)
    const newSlice = newBlocks.slice(region.newStart, region.newEnd)
    const total = Math.max(oldSlice.length, newSlice.length)
    for (let index = 0; index < total; index += 1) {
      const oldBlock = oldSlice[index]
      const newBlock = newSlice[index]
      if (oldBlock && newBlock) {
        const change = describeModified(oldBlock, newBlock)
        if (change) {
          consumedOld += 1
          push(change)
        }
      } else if (oldBlock) {
        consumedOld += 1
        push(describeRemoved(oldBlock))
      } else if (newBlock) {
        push(describeAdded(newBlock))
      }
    }
  }

  return {
    changes,
    contentChanges,
    formatChanges,
    untouched: Math.max(0, oldBlocks.length - consumedOld),
    oldBlocks: oldBlocks.length,
    newBlocks: newBlocks.length,
    truncated,
  }
}

export function previewSourceDiff(before: string, after: string): DiffPreview {
  const left = splitLines(before)
  const right = splitLines(after)

  let prefix = 0
  const maxPrefix = Math.min(left.length, right.length)
  while (prefix < maxPrefix && left[prefix] === right[prefix]) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < Math.min(left.length, right.length) - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const removedLines = left.slice(prefix, left.length - suffix)
  const addedLines = right.slice(prefix, right.length - suffix)
  const changed = removedLines.length > 0 || addedLines.length > 0
  const rows: DiffRow[] = []

  const contextStart = Math.max(0, prefix - CONTEXT_LINES)
  if (contextStart > 0) {
    rows.push({ kind: 'gap', text: `${contextStart} 行未改动` })
  }
  for (let index = contextStart; index < prefix; index += 1) {
    rows.push({
      kind: 'context',
      text: left[index] ?? '',
      before: index + 1,
      after: index + 1,
    })
  }

  let truncated = false
  let removedShown = removedLines
  let addedShown = addedLines
  if (removedLines.length + addedLines.length > MAX_MIDDLE_LINES) {
    truncated = true
    const budget = Math.floor(MAX_MIDDLE_LINES / 2)
    removedShown = removedLines.slice(0, budget)
    addedShown = addedLines.slice(0, budget)
  }

  for (let index = 0; index < removedShown.length; index += 1) {
    rows.push({
      kind: 'removed',
      text: removedShown[index] ?? '',
      before: prefix + index + 1,
    })
  }
  for (let index = 0; index < addedShown.length; index += 1) {
    rows.push({
      kind: 'added',
      text: addedShown[index] ?? '',
      after: prefix + index + 1,
    })
  }
  if (truncated) {
    rows.push({
      kind: 'gap',
      text: `还有 ${removedLines.length - removedShown.length + (addedLines.length - addedShown.length)} 行改动未展示`,
    })
  }

  if (suffix > CONTEXT_LINES) {
    rows.push({ kind: 'gap', text: `${suffix - CONTEXT_LINES} 行未改动` })
  }
  for (let index = Math.max(0, suffix - CONTEXT_LINES); index < suffix; index += 1) {
    const offset = suffix - index
    rows.push({
      kind: 'context',
      text: left[left.length - offset] ?? '',
      before: left.length - offset + 1,
      after: right.length - offset + 1,
    })
  }

  return {
    rows,
    added: addedLines.length,
    removed: removedLines.length,
    changed,
    truncated,
  }
}

export function analyzeSourceChanges(before: string, after: string): SourceAnalysis {
  return {
    preview: previewSourceDiff(before, after),
    blocks: analyzeBlockChanges(before, after),
  }
}
