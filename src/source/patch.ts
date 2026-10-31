import { SourceBuffer } from './SourceBuffer.js'
import { walkSpans } from './SourceMap.js'
import type {
  ApplyResult,
  PatchResult,
  SourceEdit,
  SourceMap,
  SourceSpan,
} from './types.js'

export type MarkType = 'bold' | 'italic' | 'strike' | 'code'

export interface ReplaceTextRequest {
  spanId: string
  from: number
  to: number
  insert: string
}

export interface ToggleMarkRequest {
  spanId: string
  from: number
  to: number
  mark: MarkType
  enabled: boolean
}

export interface DelimiterPreferences {
  bold: '**' | '__'
  italic: '*' | '_'
}

const MARK_TOKEN_TYPES: Record<MarkType, string> = {
  bold: 'strong',
  italic: 'emphasis',
  strike: 'strikethrough',
  code: 'code',
}

export function analyzeDelimiterPreferences(map: SourceMap): DelimiterPreferences {
  let doubleStars = 0
  let doubleUnderscores = 0
  let stars = 0
  let underscores = 0

  for (const span of walkSpans(map.roots)) {
    if (span.tokenType === 'strong') {
      if (span.prefixRaw === '**') {
        doubleStars += 1
      } else if (span.prefixRaw === '__') {
        doubleUnderscores += 1
      }
    } else if (span.tokenType === 'emphasis') {
      if (span.prefixRaw === '*') {
        stars += 1
      } else if (span.prefixRaw === '_') {
        underscores += 1
      }
    }
  }

  return {
    bold: doubleUnderscores > doubleStars ? '__' : '**',
    italic: underscores > stars ? '_' : '*',
  }
}

export function replaceText(buffer: SourceBuffer, request: ReplaceTextRequest): PatchResult {
  const span = requireSpan(buffer, request.spanId)
  const editable = editableLeaf(span, buffer)
  if (!editable.ok) {
    return failure('S5', editable.reason, true)
  }

  if (
    request.from < 0 ||
    request.to < request.from ||
    request.to > span.raw.length ||
    request.from < span.contentStart - span.start ||
    request.to > span.contentEnd - span.start
  ) {
    throw new Error(`Replacement range is outside span ${span.id} content`)
  }

  if (containsLineBreak(request.insert)) {
    return failure('S4', 'Inserting line breaks requires block-level source editing', true)
  }
  if (rangeSplitsSurrogate(buffer.current, request.from + span.start, request.to + span.start)) {
    return failure('S5', 'Selection splits a surrogate pair', true)
  }

  const edits: SourceEdit[] = [
    {
      from: span.start + request.from,
      to: span.start + request.to,
      insert: request.insert,
    },
  ]

  const result = buffer.applyEdits(edits, 'S1')
  return {
    ...result,
    affectedSpanIds: dirtySpanIds(buffer, result),
  }
}

export function setSpanText(buffer: SourceBuffer, spanId: string, text: string): PatchResult {
  const span = requireSpan(buffer, spanId)
  const editable = editableLeaf(span, buffer)
  if (!editable.ok) {
    return failure('S5', editable.reason, true)
  }
  if (containsLineBreak(text)) {
    return failure('S4', 'New line breaks require block-level source editing', true)
  }

  const currentContent = buffer.current.slice(span.contentStart, span.contentEnd)
  const { prefix, suffix } = commonAffixes(currentContent, text)
  const from = span.contentStart - span.start + prefix
  const to = span.contentEnd - span.start - suffix
  const insert = text.slice(prefix, text.length - suffix)

  return replaceText(buffer, { spanId, from, to, insert })
}

export function toggleMark(buffer: SourceBuffer, request: ToggleMarkRequest): PatchResult {
  const block = requireSpan(buffer, request.spanId)
  const absoluteFrom = block.contentStart + request.from
  const absoluteTo = block.contentStart + request.to

  if (
    request.from < 0 ||
    request.to <= request.from ||
    absoluteTo > block.contentEnd ||
    absoluteFrom < block.contentStart
  ) {
    throw new Error('Mark range is outside the block content')
  }

  const selected = buffer.current.slice(absoluteFrom, absoluteTo)
  if (containsLineBreak(selected)) {
    return failure('S5', 'Inline marks spanning lines require local source editing', true)
  }
  if (rangeSplitsSurrogate(buffer.current, absoluteFrom, absoluteTo)) {
    return failure('S5', 'Selection splits a surrogate pair', true)
  }

  const existing = findMarkSpan(block, MARK_TOKEN_TYPES[request.mark], absoluteFrom, absoluteTo)

  if (request.enabled) {
    if (existing) {
      return failure('S0', 'Mark already applied', false)
    }

    const delimiters = delimitersFor(buffer, request.mark, selected, absoluteFrom, absoluteTo)
    if (!delimiters) {
      return failure('S5', 'Content cannot be wrapped without changing it', true)
    }

    const edits: SourceEdit[] = [
      { from: absoluteFrom, to: absoluteFrom, insert: delimiters.open },
      { from: absoluteTo, to: absoluteTo, insert: delimiters.close },
    ]

    const applied = applyWithVerification(
      buffer,
      edits,
      'S2',
      preview =>
        Boolean(
          deepestSpan(preview.map, span => {
            return (
              span.tokenType === MARK_TOKEN_TYPES[request.mark] &&
              span.contentStart === absoluteFrom + delimiters.open.length &&
              span.contentEnd === absoluteTo + delimiters.open.length
            )
          }),
        ),
      'The wrapped range did not parse as the requested mark',
    )

    return applied ?? failure('S5', 'Mark could not be verified', true)
  }

  if (!existing) {
    return failure('S0', 'Mark is not applied to the whole range', false)
  }

  if (existing.contentStart !== absoluteFrom || existing.contentEnd !== absoluteTo) {
    return failure('S5', 'Partial mark removal requires local source editing', true)
  }

  if (!isRemovableMark(existing, request.mark)) {
    return failure('S5', 'Mark delimiters are not safely removable', true)
  }

  const openingLength = existing.contentStart - existing.start
  const edits: SourceEdit[] = [
    { from: existing.start, to: existing.contentStart, insert: '' },
    { from: existing.contentEnd, to: existing.end, insert: '' },
  ]

  const applied = applyWithVerification(
    buffer,
    edits,
    'S2',
    preview =>
      !deepestSpan(preview.map, span => {
        return (
          span.tokenType === MARK_TOKEN_TYPES[request.mark] &&
          span.contentStart === absoluteFrom &&
          span.contentEnd === absoluteTo - openingLength
        )
      }),
    'The mark delimiters were not removed cleanly',
  )

  return applied ?? failure('S5', 'Mark removal could not be verified', true)
}

export function setHeadingLevel(
  buffer: SourceBuffer,
  spanId: string,
  level: number,
): PatchResult {
  if (!Number.isInteger(level) || level < 0 || level > 6) {
    throw new Error('Heading level must be an integer from 0 to 6')
  }

  const span = requireSpan(buffer, spanId)
  if (span.tokenType !== 'heading' && span.tokenType !== 'paragraph') {
    return failure('S5', 'Only paragraphs and headings can change heading level', true)
  }

  const firstLineEnd = buffer.current.indexOf('\n', span.start)
  const lineEnd = firstLineEnd === -1 || firstLineEnd > span.end ? span.end : firstLineEnd
  const firstLine = buffer.current.slice(span.start, lineEnd)
  const atx = /^( {0,3})(#{1,6})([ \t]+|$)/.exec(firstLine)
  const edits: SourceEdit[] = []
  let verifyOffset: number

  if (span.tokenType === 'heading') {
    if (span.attrs?.headingStyle === 'setext') {
      return failure('S5', 'Setext headings require local source editing for level changes', true)
    }
    if (!atx) {
      return failure('S5', 'Heading prefix is not a recognizable ATX marker', true)
    }

    const indentLength = atx[1]!.length
    const separator = atx[3] ?? ''
    const hashStart = span.start + indentLength
    const hashEnd = span.start + atx[0].length
    verifyOffset = hashStart

    if (level === 0) {
      edits.push({ from: hashStart, to: hashEnd, insert: '' })
      const closing = /^([ \t]+)(#+)([ \t]*)$/.exec(
        buffer.current.slice(span.contentEnd, lineEnd),
      )
      if (closing) {
        const closingStart = span.contentEnd + closing[1]!.length
        edits.push({
          from: span.contentEnd,
          to: closingStart + closing[2]!.length,
          insert: '',
        })
      }
    } else {
      const replacement = `${'#'.repeat(level)}${separator.length > 0 ? separator : ' '}`
      edits.push({ from: hashStart, to: hashEnd, insert: replacement })
    }
  } else {
    if (level === 0) {
      return failure('S0', 'Paragraph is already a paragraph', false)
    }
    const insertAt = span.contentStart
    verifyOffset = insertAt
    edits.push({ from: insertAt, to: insertAt, insert: `${'#'.repeat(level)} ` })
  }

  const applied = applyWithVerification(
    buffer,
    edits,
    'S3',
    preview => {
      if (level === 0) {
        return Boolean(
          deepestSpan(preview.map, span => {
            return span.tokenType === 'paragraph' && span.start <= verifyOffset && verifyOffset <= span.contentStart
          }),
        )
      }
      return Boolean(
        deepestSpan(preview.map, span => {
          return (
            span.tokenType === 'heading' &&
            span.attrs?.headingLevel === level &&
            span.start <= verifyOffset &&
            verifyOffset <= span.contentStart
          )
        }),
      )
    },
    'Heading structure did not match the requested level',
  )

  return applied ?? failure('S5', 'Heading change could not be verified', true)
}

export function setListItemMarker(
  buffer: SourceBuffer,
  spanId: string,
  marker: string,
): PatchResult {
  if (!/^(?:[-+*]|\d{1,9}[.)])$/.test(marker)) {
    throw new Error(`Invalid list marker: ${marker}`)
  }

  const item = requireSpan(buffer, spanId)
  if (item.tokenType !== 'list_item') {
    return failure('S5', 'Span is not a list item', true)
  }

  const lineEnd = lineEndOf(buffer.current, item.start, item.end)
  const firstLine = buffer.current.slice(item.start, lineEnd)
  const existing = /^( {0,3})([-+*]|\d{1,9}[.)])/.exec(firstLine)
  if (!existing) {
    return failure('S5', 'List marker could not be located', true)
  }

  if (existing[2]!.length !== marker.length) {
    return failure('S4', 'Changing marker width would reindent continuation lines', true)
  }

  const from = item.start + existing[1]!.length
  const to = from + existing[2]!.length
  const edits: SourceEdit[] = [{ from, to, insert: marker }]

  const applied = applyWithVerification(
    buffer,
    edits,
    'S3',
    preview =>
      Boolean(
        deepestSpan(preview.map, span => {
          return (
            span.tokenType === 'list_item' &&
            span.attrs?.marker === marker &&
            span.start <= from &&
            from <= span.contentStart
          )
        }),
      ),
    'List marker change did not survive re-indexing',
  )

  return applied ?? failure('S5', 'List marker change could not be verified', true)
}

export function setTaskChecked(
  buffer: SourceBuffer,
  spanId: string,
  checked: boolean,
): PatchResult {
  const item = requireSpan(buffer, spanId)
  if (item.tokenType !== 'list_item' || !item.attrs?.task) {
    return failure('S5', 'Span is not a task list item', true)
  }

  const prefix = buffer.current.slice(item.start, item.contentStart)
  const match = /\[([ xX])\]/.exec(prefix)
  if (!match) {
    return failure('S5', 'Task checkbox could not be located', true)
  }

  const wasUppercase = match[1] === 'X'
  const replacement = checked ? (wasUppercase ? 'X' : 'x') : ' '
  const from = item.start + match.index + 1
  const to = from + 1
  const edits: SourceEdit[] = [{ from, to, insert: replacement }]

  const applied = applyWithVerification(
    buffer,
    edits,
    'S3',
    preview =>
      Boolean(
        deepestSpan(preview.map, span => {
          return (
            span.tokenType === 'list_item' &&
            span.attrs?.checked === checked &&
            span.start <= from &&
            from <= span.contentEnd
          )
        }),
      ),
    'Task state change did not survive re-indexing',
  )

  return applied ?? failure('S5', 'Task state change could not be verified', true)
}

export function replaceBlockRaw(
  buffer: SourceBuffer,
  spanId: string,
  raw: string,
): PatchResult {
  const span = requireSpan(buffer, spanId)
  const result = buffer.applyEdits([{ from: span.start, to: span.end, insert: raw }], 'S5')
  return {
    ...result,
    affectedSpanIds: dirtySpanIds(buffer, result),
  }
}

function applyWithVerification(
  buffer: SourceBuffer,
  edits: SourceEdit[],
  level: 'S2' | 'S3',
  verify: (preview: SourceBuffer) => boolean,
  reason: string,
): PatchResult | null {
  const preview = new SourceBuffer({
    ...buffer.envelope,
    source: buffer.current,
    originalSha256: buffer.baselineSha256,
  })
  const previewResult = preview.applyEdits(edits, level)

  if (!previewResult.applied) {
    return { ...previewResult, affectedSpanIds: [] }
  }

  if (!verify(preview)) {
    return failure('S5', reason, true)
  }

  const applied = buffer.applyEdits(edits, level)
  return {
    ...applied,
    affectedSpanIds: dirtySpanIds(buffer, applied),
  }
}

function failure(
  level: 'S0' | 'S4' | 'S5',
  reason: string,
  requiresSourceEdit: boolean,
): PatchResult {
  return {
    level,
    applied: false,
    revision: -1,
    dirty: [],
    affectedSpanIds: [],
    reason,
    requiresSourceEdit,
  }
}

function requireSpan(buffer: SourceBuffer, id: string): SourceSpan {
  const span = buffer.findSpan(id)
  if (!span) {
    throw new Error(`Unknown span: ${id}`)
  }
  return span
}

function editableLeaf(
  span: SourceSpan,
  buffer: SourceBuffer,
): { ok: true } | { ok: false; reason: string } {
  if (span.children && span.children.some(child => child.kind !== 'gap')) {
    return { ok: false, reason: 'Span contains nested structure on this level' }
  }
  if (span.kind === 'gap' || span.kind === 'block' || span.kind === 'delimiter') {
    return { ok: false, reason: 'Span is not an editable text leaf' }
  }
  if (span.kind === 'raw') {
    return { ok: false, reason: 'Raw span requires local source editing' }
  }
  if (span.tokenType === 'image' || span.tokenType === 'inline_html') {
    return { ok: false, reason: 'Atomic inline requires local source editing' }
  }
  if (rangeSplitsSurrogate(buffer.current, span.start, span.end)) {
    return { ok: false, reason: 'Span contains an unpaired surrogate' }
  }
  return { ok: true }
}

function containsLineBreak(text: string): boolean {
  return text.includes('\n') || text.includes('\r')
}

function lineEndOf(text: string, start: number, limit: number): number {
  const newline = text.indexOf('\n', start)
  if (newline === -1 || newline > limit) {
    return limit
  }
  return newline
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

function rangeSplitsSurrogate(text: string, from: number, to: number): boolean {
  if (from > 0 && from < text.length) {
    if (isHighSurrogate(text.charCodeAt(from - 1)) && isLowSurrogate(text.charCodeAt(from))) {
      return true
    }
  }
  if (to > 0 && to < text.length) {
    if (isHighSurrogate(text.charCodeAt(to - 1)) && isLowSurrogate(text.charCodeAt(to))) {
      return true
    }
  }
  return false
}

function commonAffixes(
  current: string,
  next: string,
): { prefix: number; suffix: number } {
  let prefix = 0
  while (prefix < current.length && prefix < next.length && current[prefix] === next[prefix]) {
    prefix += 1
  }
  if (prefix > 0 && prefix < current.length) {
    if (
      isHighSurrogate(current.charCodeAt(prefix - 1)) &&
      isLowSurrogate(current.charCodeAt(prefix))
    ) {
      prefix -= 1
    }
  }

  let suffix = 0
  while (
    suffix < current.length - prefix &&
    suffix < next.length - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1
  }
  if (suffix > 0) {
    const startInCurrent = current.length - suffix
    if (
      startInCurrent > 0 &&
      isHighSurrogate(current.charCodeAt(startInCurrent - 1)) &&
      isLowSurrogate(current.charCodeAt(startInCurrent))
    ) {
      suffix -= 1
    }
  }

  return { prefix, suffix }
}

function findMarkSpan(
  block: SourceSpan,
  tokenType: string,
  absoluteFrom: number,
  absoluteTo: number,
): SourceSpan | undefined {
  let found: SourceSpan | undefined

  const visit = (span: SourceSpan) => {
    for (const child of span.children ?? []) {
      if (
        child.tokenType === tokenType &&
        child.contentStart <= absoluteFrom &&
        child.contentEnd >= absoluteTo
      ) {
        found = child
      }
      visit(child)
    }
  }
  visit(block)

  return found
}

function isRemovableMark(span: SourceSpan, mark: MarkType): boolean {
  const prefix = span.prefixRaw ?? ''
  const suffix = span.suffixRaw ?? ''

  switch (mark) {
    case 'bold':
      return (prefix === '**' || prefix === '__') && prefix === suffix
    case 'italic':
      return (prefix === '*' || prefix === '_') && prefix === suffix
    case 'strike':
      return prefix === '~~' && suffix === '~~'
    case 'code': {
      const open = /^`+$/.test(prefix)
      return open && prefix === suffix
    }
  }
}

function delimitersFor(
  buffer: SourceBuffer,
  mark: MarkType,
  selected: string,
  absoluteFrom: number,
  absoluteTo: number,
): { open: string; close: string } | null {
  if (containsLineBreak(selected)) {
    return null
  }

  if (mark === 'code') {
    if (/^\s|\s$|`/.test(selected)) {
      return null
    }
    const longest = longestBacktickRun(selected)
    const fence = '`'.repeat(longest + 1)
    return { open: fence, close: fence }
  }

  if (mark === 'strike') {
    return { open: '~~', close: '~~' }
  }

  const preferences = analyzeDelimiterPreferences(buffer.map)
  const wordBefore = /[\p{L}\p{N}_]/u.test(buffer.current[absoluteFrom - 1] ?? '')
  const wordAfter = /[\p{L}\p{N}_]/u.test(buffer.current[absoluteTo] ?? '')
  const intraword = wordBefore || wordAfter

  if (mark === 'bold') {
    const delimiter = preferences.bold === '__' && intraword ? '**' : preferences.bold
    return { open: delimiter, close: delimiter }
  }

  const delimiter = preferences.italic === '_' && intraword ? '*' : preferences.italic
  return { open: delimiter, close: delimiter }
}

function longestBacktickRun(text: string): number {
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
  return longest
}

function dirtySpanIds(buffer: SourceBuffer, result: ApplyResult): string[] {
  if (!result.applied) {
    return []
  }

  const ids = new Set<string>()
  for (const range of result.dirty) {
    const offset = Math.min(range.from, buffer.current.length - 1)
    const span = deepestSpanAt(buffer.map, offset)
    if (span) {
      ids.add(span.id)
    }
  }
  return [...ids]
}

function deepestSpan(
  map: SourceMap,
  predicate: (span: SourceSpan) => boolean,
): SourceSpan | undefined {
  let found: SourceSpan | undefined
  for (const span of walkSpans(map.roots)) {
    if (predicate(span)) {
      found = span
    }
  }
  return found
}

function deepestSpanAt(map: SourceMap, offset: number): SourceSpan | undefined {
  if (map.roots.length === 0) {
    return undefined
  }

  let current: SourceSpan | undefined
  const visit = (span: SourceSpan) => {
    if (offset < span.start || offset >= span.end) {
      return
    }
    current = span
    for (const child of span.children ?? []) {
      visit(child)
    }
  }
  for (const root of map.roots) {
    visit(root)
  }
  return current
}
