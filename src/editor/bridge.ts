import type { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

import { eolSequenceAt } from '../source/encoding.js'
import {
  replaceText,
  setHeadingLevel,
  toggleMark as toggleSourceMark,
} from '../source/patch.js'
import { projectDocument } from '../source/projection.js'
import type { SourceBuffer } from '../source/SourceBuffer.js'
import type { SourceEdit, SourceSpan } from '../source/types.js'
import { textContent, toTiptapDocument } from './project.js'
import { serializeBlocks } from './serialize.js'

export type MarkName = 'bold' | 'italic' | 'strike' | 'code'

export interface SelectionHint {
  blockIndex: number
  offset: number
  endOffset?: number
}

export interface BridgeCallbacks {
  onSourceApplied: () => void
  onProjected: (json: JSONContent, hint?: SelectionHint) => void
  onNotice: (message: string) => void
}

interface FlatAnchor {
  id: string | null
  text: string
  marks: string
}

interface FlatBlock {
  type: string
  sourceId: string | null
  attrs: string
  level: number | null
  anchors: FlatAnchor[]
  atomic: string
  text: string
}

interface DiffOutcome {
  ok: boolean
  reason?: string
}

const PM_MARKS: Record<MarkName, string> = {
  bold: 'bold',
  italic: 'italic',
  strike: 'strike',
  code: 'code',
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue)
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      result[key] = stableValue(record[key])
    }
    return result
  }
  return value
}

function canonicalMark(mark: { type: string; attrs?: Record<string, unknown> }): unknown {
  return { type: mark.type, attrs: stableValue(mark.attrs ?? {}) }
}

function markSignature(node: JSONContent): string {
  const marks = (node.marks ?? [])
    .filter(mark => mark.type !== 'sourceAnchor')
    .map(canonicalMark)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  return JSON.stringify(marks)
}

function anchorId(node: JSONContent): string | null {
  const anchor = (node.marks ?? []).find(mark => mark.type === 'sourceAnchor')
  const id = anchor?.attrs?.sourceId
  return typeof id === 'string' ? id : null
}

function unsourcedEmpty(node: JSONContent): boolean {
  return (
    node.type === 'paragraph' &&
    typeof node.attrs?.sourceId !== 'string' &&
    (node.content?.length ?? 0) === 0
  )
}

function canonicalTop(node: JSONContent): string {
  const visit = (value: JSONContent): unknown => {
    if (value.type === 'text') {
      return {
        type: 'text',
        text: value.text ?? '',
        marks: (value.marks ?? [])
          .filter(mark => mark.type !== 'sourceAnchor')
          .map(canonicalMark)
          .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      }
    }
    return {
      type: value.type,
      attrs: stableValue(value.attrs ?? {}),
      content: (value.content ?? []).map(visit),
    }
  }
  return JSON.stringify(visit(node))
}

function flattenBlocks(doc: JSONContent): FlatBlock[] {
  const blocks: FlatBlock[] = []

  const makeBlock = (node: JSONContent): FlatBlock => {
    const anchors: FlatAnchor[] = []
    const atomic: unknown[] = []

    for (const child of node.content ?? []) {
      if (child.type === 'text') {
        anchors.push({
          id: anchorId(child),
          text: child.text ?? '',
          marks: markSignature(child),
        })
      } else {
        atomic.push({
          type: child.type,
          attrs: stableValue(child.attrs ?? {}),
        })
      }
    }

    const attrs = { ...(node.attrs ?? {}) }
    const level =
      node.type === 'heading' && typeof attrs.level === 'number' ? attrs.level : null
    delete attrs.sourceId
    delete attrs.level

    return {
      type: node.type ?? '',
      sourceId:
        typeof node.attrs?.sourceId === 'string' ? (node.attrs.sourceId as string) : null,
      attrs: JSON.stringify(stableValue(attrs)),
      level,
      anchors,
      atomic: JSON.stringify(atomic),
      text: anchors.map(anchor => anchor.text).join(''),
    }
  }

  const walk = (node: JSONContent) => {
    if (['paragraph', 'heading', 'codeBlock'].includes(node.type ?? '')) {
      blocks.push(makeBlock(node))
      return
    }
    for (const child of node.content ?? []) {
      if (child.type === 'text') {
        continue
      }
      walk(child)
    }
  }

  for (const top of doc.content ?? []) {
    walk(top)
  }
  return blocks
}

function anchorShape(block: FlatBlock): string {
  return JSON.stringify(block.anchors.map(anchor => ({ id: anchor.id, marks: anchor.marks })))
}

function sameBlockShape(left: FlatBlock, right: FlatBlock, includeText: boolean): boolean {
  if (
    left.type !== right.type ||
    left.sourceId !== right.sourceId ||
    left.attrs !== right.attrs ||
    left.atomic !== right.atomic ||
    anchorShape(left) !== anchorShape(right)
  ) {
    return false
  }
  return !includeText || left.text === right.text
}

function commonAffixes(left: string, right: string): { prefix: number; suffix: number } {
  let prefix = 0
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
    prefix += 1
  }
  if (
    prefix > 0 &&
    prefix < left.length &&
    /[\uD800-\uDBFF]/.test(left[prefix - 1] ?? '') &&
    /[\uDC00-\uDFFF]/.test(left[prefix] ?? '')
  ) {
    prefix -= 1
  }

  let suffix = 0
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix += 1
  }
  if (suffix > 0) {
    const tailStart = left.length - suffix
    if (
      tailStart > 0 &&
      /[\uD800-\uDBFF]/.test(left[tailStart - 1] ?? '') &&
      /[\uDC00-\uDFFF]/.test(left[tailStart] ?? '')
    ) {
      suffix -= 1
    }
  }

  return { prefix, suffix }
}

export class EditorBridge {
  private lastDoc: JSONContent
  private applying = false
  private destroyed = false

  constructor(
    private readonly editor: Editor,
    private readonly buffer: SourceBuffer,
    private readonly callbacks: BridgeCallbacks,
  ) {
    this.lastDoc = editor.getJSON()
    editor.on('update', this.handleUpdate)
  }

  destroy(): void {
    this.destroyed = true
    this.editor.off('update', this.handleUpdate)
  }

  syncFromEditor(json = this.editor.getJSON()): void {
    this.lastDoc = json
  }

  toggleMark(mark: MarkName): boolean {
    if (this.buffer.envelope.readOnlyReason) {
      this.callbacks.onNotice('该文件以只读方式打开，无法修改。')
      return true
    }

    const { from, to } = this.editor.state.selection
    if (from === to) {
      return false
    }

    const runs = this.textRuns()
    const startRun =
      runs.find(run => from >= run.from && from < run.to) ??
      runs.find(run => from === run.to)
    const endRun = [...runs].reverse().find(run => to > run.from && to <= run.to)
    if (!startRun || !endRun || startRun.id !== endRun.id) {
      return false
    }

    const flat = flattenBlocks(this.lastDoc).find(block =>
      block.anchors.some(anchor => anchor.id === startRun.id),
    )
    if (!flat?.sourceId) {
      return false
    }

    const anchorSpan = this.buffer.findSpan(startRun.id)
    const blockSpan = this.buffer.findSpan(flat.sourceId)
    if (!anchorSpan || !blockSpan) {
      return false
    }

    const absoluteFrom = anchorSpan.contentStart + (from - startRun.from)
    const absoluteTo = anchorSpan.contentStart + (to - startRun.from)
    if (absoluteTo > anchorSpan.contentEnd) {
      return false
    }

    const active = this.editor.isActive(PM_MARKS[mark])
    const result = toggleSourceMark(this.buffer, {
      spanId: blockSpan.id,
      from: absoluteFrom - blockSpan.contentStart,
      to: absoluteTo - blockSpan.contentStart,
      mark,
      enabled: !active,
    })

    if (!result.applied) {
      return false
    }

    const markType = this.editor.schema.marks[PM_MARKS[mark]]
    if (markType) {
      const transaction = this.editor.state.tr
      if (active) {
        transaction.removeMark(from, to, markType)
      } else {
        transaction.addMark(from, to, markType.create())
      }
      transaction.setMeta('ynote:sync', true)
      this.applying = true
      try {
        this.editor.view.dispatch(transaction)
      } finally {
        this.applying = false
      }
    }

    this.lastDoc = this.editor.getJSON()
    this.callbacks.onSourceApplied()
    this.ensureAnchors()
    return true
  }

  setBlockType(level: number): boolean {
    if (this.buffer.envelope.readOnlyReason) {
      this.callbacks.onNotice('该文件以只读方式打开，无法修改。')
      return true
    }

    const { $from } = this.editor.state.selection
    for (let depth = $from.depth; depth >= 1; depth -= 1) {
      const node = $from.node(depth)
      const sourceId = node.attrs.sourceId
      if (
        (node.type.name === 'paragraph' || node.type.name === 'heading') &&
        typeof sourceId === 'string'
      ) {
        if (node.type.name === 'heading' && node.attrs.level === level) {
          return true
        }
        if (node.type.name === 'paragraph' && level === 0) {
          return true
        }

        const hint = this.captureHint()
        const result = setHeadingLevel(this.buffer, sourceId, level)
        if (!result.applied) {
          this.callbacks.onNotice(result.reason ?? '当前块不支持该标题级别修改。')
          return true
        }

        this.reproject(hint)
        return true
      }
    }

    return false
  }

  private handleUpdate = (): void => {
    if (this.applying || this.destroyed) {
      return
    }

    const next = this.editor.getJSON()
    if (canonicalTop(next) === canonicalTop(this.lastDoc)) {
      this.lastDoc = next
      return
    }

    const hint = this.captureHint()
    const outcome = this.apply(next, hint)
    if (outcome.ok) {
      return
    }

    this.revert()
    this.callbacks.onNotice(
      outcome.reason ??
        '该修改无法安全映射到 Markdown 源码，已恢复。请切换到源码视图完成此操作。',
    )
  }

  private apply(next: JSONContent, hint: SelectionHint): DiffOutcome {
    if (this.buffer.envelope.readOnlyReason) {
      return { ok: false, reason: '该文件以只读方式打开，无法修改。' }
    }

    const oldFlat = flattenBlocks(this.lastDoc)
    const newFlat = flattenBlocks(next)

    if (oldFlat.length === newFlat.length) {
      let structural = false
      let levelChange: { old: FlatBlock; next: FlatBlock } | null = null
      const textChanges: Array<{ old: FlatBlock; next: FlatBlock }> = []

      for (let index = 0; index < oldFlat.length; index += 1) {
        const left = oldFlat[index]!
        const right = newFlat[index]!
        if (!sameBlockShape(left, right, false)) {
          structural = true
          break
        }
        if (left.level !== right.level) {
          levelChange = { old: left, next: right }
        }
        if (left.text !== right.text) {
          textChanges.push({ old: left, next: right })
        }
      }

      if (!structural) {
        if (textChanges.length === 0 && levelChange) {
          const sourceId = levelChange.old.sourceId
          if (!sourceId) {
            return { ok: false, reason: '标题块缺少源映射，已恢复。' }
          }
          const result = setHeadingLevel(
            this.buffer,
            sourceId,
            levelChange.next.level ?? 1,
          )
          if (!result.applied) {
            return {
              ok: false,
              reason: result.reason ?? '标题级别无法无损写回，已恢复。',
            }
          }
          this.lastDoc = next
          this.callbacks.onSourceApplied()
          this.ensureAnchors()
          return { ok: true }
        }

        if (textChanges.length === 1 && !levelChange) {
          const outcome = this.applyTextChange(textChanges[0]!.old, textChanges[0]!.next)
          if (outcome === true) {
            this.lastDoc = next
            this.callbacks.onSourceApplied()
            this.ensureAnchors()
            return { ok: true }
          }
          if (outcome !== false) {
            return outcome
          }
        }
      }
    }

    return this.rebuildRegion(next, hint)
  }

  private applyTextChange(oldBlock: FlatBlock, newBlock: FlatBlock): true | false | DiffOutcome {
    if (oldBlock.type === 'codeBlock') {
      return this.applyCodeText(oldBlock, newBlock)
    }
    if (oldBlock.type !== 'paragraph' && oldBlock.type !== 'heading') {
      return false
    }

    const changed = oldBlock.anchors
      .map((anchor, index) => ({ anchor, next: newBlock.anchors[index]! }))
      .filter(pair => pair.anchor.text !== pair.next.text)

    if (changed.length !== 1) {
      return false
    }

    const { anchor, next } = changed[0]!
    if (!anchor.id || next.id !== anchor.id || anchor.marks !== next.marks) {
      return false
    }

    const span = this.buffer.findSpan(anchor.id)
    if (!span || span.kind !== 'inline' || span.tokenType !== 'text') {
      return false
    }
    if (this.buffer.current.slice(span.contentStart, span.contentEnd) !== anchor.text) {
      return false
    }
    if (next.text.includes('\n') || next.text.includes('\r')) {
      return false
    }

    const { prefix, suffix } = commonAffixes(anchor.text, next.text)
    const result = replaceText(this.buffer, {
      spanId: anchor.id,
      from: prefix,
      to: anchor.text.length - suffix,
      insert: next.text.slice(prefix, next.text.length - suffix),
    })

    if (result.applied) {
      return true
    }
    return false
  }

  private applyCodeText(oldBlock: FlatBlock, newBlock: FlatBlock): true | false | DiffOutcome {
    if (!oldBlock.sourceId) {
      return false
    }
    const span = this.buffer.findSpan(oldBlock.sourceId)
    if (!span || span.tokenType !== 'code_block') {
      return false
    }

    const current = this.buffer.current.slice(span.contentStart, span.contentEnd)
    const eol = this.eolAt(span.contentStart)
    if (
      current !== oldBlock.text &&
      current !== `${oldBlock.text}${eol}` &&
      current !== `${oldBlock.text}\n`
    ) {
      return false
    }

    const oldText = oldBlock.text
    const newText = newBlock.text
    if (oldText === newText) {
      return true
    }

    const base = span.contentStart
    const { prefix, suffix } = commonAffixes(oldText, newText)
    const edit: SourceEdit = {
      from: base + prefix,
      to: base + oldText.length - suffix,
      insert: newText.slice(prefix, newText.length - suffix),
    }

    const result = this.buffer.applyEdits([edit], 'S2')
    return result.applied ? true : false
  }

  private rebuildRegion(next: JSONContent, hint: SelectionHint): DiffOutcome {
    const oldTop = (this.lastDoc.content ?? []).filter(node => !unsourcedEmpty(node))
    const newTop = (next.content ?? []).filter(node => !unsourcedEmpty(node))
    const oldCanon = oldTop.map(canonicalTop)
    const newCanon = newTop.map(canonicalTop)

    let start = 0
    const maxPrefix = Math.min(oldCanon.length, newCanon.length)
    while (start < maxPrefix && oldCanon[start] === newCanon[start]) {
      start += 1
    }

    let suffix = 0
    while (
      suffix < Math.min(oldCanon.length, newCanon.length) - start &&
      oldCanon[oldCanon.length - 1 - suffix] === newCanon[newCanon.length - 1 - suffix]
    ) {
      suffix += 1
    }

    const oldEnd = oldCanon.length - suffix
    const newEnd = newCanon.length - suffix
    const removed = oldTop.slice(start, oldEnd)
    const inserted = newTop.slice(start, newEnd)

    if (removed.length === 0 && inserted.length === 0) {
      this.lastDoc = next
      return { ok: true }
    }

    const roots = this.buffer.map.roots.filter(root => root.kind !== 'gap')

    if (roots.length === 0 && this.buffer.current.length === 0) {
      if (inserted.length === 0) {
        this.lastDoc = next
        return { ok: true }
      }
      const emptyEol = this.eolAt(0)
      const contents = serializeBlocks(inserted, emptyEol)
      if (contents === null) {
        return {
          ok: false,
          reason: '该结构暂不支持自动写回（如表格），已恢复。请使用源码视图编辑。',
        }
      }
      if (contents.length === 0) {
        this.lastDoc = next
        return { ok: true }
      }
      const result = this.buffer.applyEdits(
        [{ from: 0, to: 0, insert: `${contents}${emptyEol}` }],
        'S4',
      )
      if (!result.applied) {
        return { ok: false, reason: '源码重建未产生有效修改，已恢复。' }
      }
      this.reproject(hint)
      return { ok: true }
    }

    if (roots.length !== oldTop.length) {
      return {
        ok: false,
        reason: '源码块与编辑结构数量不一致，已恢复。请使用源码视图编辑此位置。',
      }
    }

    if (removed.some(block => block.type === 'table')) {
      return {
        ok: false,
        reason: '暂不支持表格结构编辑；单元格文字可直接修改。',
      }
    }

    const eol = this.eolAt(start < roots.length ? roots[start]!.start : this.buffer.current.length)
    const body = serializeBlocks(inserted, eol)
    if (body === null) {
      return {
        ok: false,
        reason: '该结构暂不支持自动写回（如表格或 Setext 标题），已恢复。',
      }
    }

    let edit: SourceEdit
    if (removed.length > 0) {
      const first = roots[start]! as SourceSpan
      const last = roots[oldEnd - 1]! as SourceSpan
      edit = { from: first.start, to: last.end, insert: body }
    } else if (start < roots.length) {
      const at = roots[start]!.start
      edit = { from: at, to: at, insert: `${body}${eol}${eol}` }
    } else {
      const current = this.buffer.current
      let separator = eol + eol
      if (current.endsWith(eol + eol)) {
        separator = ''
      } else if (current.endsWith(eol)) {
        separator = eol
      }
      const trailing = current.length > 0 ? eol : ''
      edit = {
        from: current.length,
        to: current.length,
        insert: `${separator}${body}${trailing}`,
      }
    }

    const result = this.buffer.applyEdits([edit], 'S4')
    if (!result.applied) {
      return { ok: false, reason: '源码重建未产生有效修改，已恢复。' }
    }

    this.reproject(hint)
    return { ok: true }
  }

  private reproject(hint?: SelectionHint): void {
    const projected = toTiptapDocument(projectDocument(this.buffer.map))
    this.lastDoc = projected
    this.callbacks.onProjected(projected, hint)
  }

  private ensureAnchors(): void {
    if (this.anchorsValid()) {
      return
    }
    this.reproject(this.captureHint())
  }

  private anchorsValid(): boolean {
    for (const block of flattenBlocks(this.lastDoc)) {
      for (const anchor of block.anchors) {
        if (!anchor.id) {
          continue
        }
        const span = this.buffer.findSpan(anchor.id)
        if (!span) {
          return false
        }
        if (this.buffer.current.slice(span.contentStart, span.contentEnd) !== anchor.text) {
          return false
        }
      }
    }
    return true
  }

  private revert(): void {
    const { from, to } = this.editor.state.selection
    this.applying = true
    try {
      this.editor.commands.setContent(this.lastDoc, { emitUpdate: false })
      const size = this.editor.state.doc.content.size
      const clampedFrom = Math.min(from, size)
      const clampedTo = Math.min(to, size)
      this.editor.commands.setTextSelection({ from: clampedFrom, to: clampedTo })
    } finally {
      this.applying = false
    }
  }

  private eolAt(offset: number): string {
    const eol = this.buffer.envelope.eol
    if (eol === 'CRLF') {
      return '\r\n'
    }
    if (eol === 'CR') {
      return '\r'
    }
    if (eol === 'LF') {
      return '\n'
    }
    return eolSequenceAt(this.buffer.current, offset)
  }

  private captureHint(): SelectionHint {
    const { from, to } = this.editor.state.selection
    const resolved = this.editor.state.doc.resolve(from)
    if (resolved.depth < 1) {
      return { blockIndex: 0, offset: 0 }
    }
    const blockIndex = resolved.index(0)
    const offset = Math.max(0, from - resolved.start(1))
    let endOffset: number | undefined
    if (to !== from) {
      const toResolved = this.editor.state.doc.resolve(to)
      if (toResolved.depth >= 1 && toResolved.index(0) === blockIndex) {
        endOffset = Math.max(0, to - toResolved.start(1))
      }
    }
    return {
      blockIndex,
      offset,
      ...(endOffset !== undefined ? { endOffset } : {}),
    }
  }

  private textRuns(): Array<{ from: number; to: number; id: string }> {
    const runs: Array<{ from: number; to: number; id: string }> = []
    this.editor.state.doc.descendants((node, position) => {
      if (!node.isText) {
        return
      }
      const anchor = node.marks.find(mark => mark.type.name === 'sourceAnchor')
      const id = anchor?.attrs.sourceId
      if (typeof id === 'string') {
        runs.push({ from: position, to: position + node.nodeSize, id })
      }
    })
    return runs
  }
}

function blockContentStart(
  doc: PMNode,
  blockIndex: number,
): { start: number; size: number } {
  const index = Math.min(Math.max(blockIndex, 0), doc.childCount - 1)
  let position = 0
  for (let childIndex = 0; childIndex < index; childIndex += 1) {
    position += doc.child(childIndex).nodeSize
  }
  const node = doc.child(index)
  return { start: position + 1, size: Math.max(node.content.size, 0) }
}

export function selectionFromHint(doc: PMNode, hint?: SelectionHint): number {
  if (!hint || doc.childCount === 0) {
    return Math.min(1, doc.content.size)
  }
  const { start, size } = blockContentStart(doc, hint.blockIndex)
  const offset = Math.max(0, Math.min(hint.offset, size))
  return Math.min(start + offset, doc.content.size)
}

export function selectionRangeFromHint(
  doc: PMNode,
  hint?: SelectionHint,
): { from: number; to: number } {
  const from = selectionFromHint(doc, hint)
  if (!hint || hint.endOffset === undefined || doc.childCount === 0) {
    return { from, to: from }
  }
  const { start, size } = blockContentStart(doc, hint.blockIndex)
  const offset = Math.max(0, Math.min(hint.endOffset, size))
  const to = Math.min(start + offset, doc.content.size)
  return { from: Math.min(from, to), to: Math.max(from, to) }
}
