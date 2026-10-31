import { encodeEnvelope } from './Envelope.js'
import { sha256 } from './encoding.js'
import {
  buildSourceMap,
  validateSourceMap,
  walkSpans,
} from './SourceMap.js'
import type {
  ApplyResult,
  EditRange,
  FileEnvelope,
  PatchLevel,
  SourceEdit,
  SourceMap,
  SourceSpan,
} from './types.js'

interface HistoryEntry {
  edits: SourceEdit[]
  inverse: SourceEdit[]
  level: PatchLevel
  before: string
  after: string
}

export interface SourceBufferOptions {
  level?: PatchLevel
  /** Prebuilt index, usually produced in a worker, to keep opening off the main thread. */
  map?: SourceMap
}

export class SourceBuffer {
  readonly envelope: FileEnvelope
  readonly original: string
  private text: string
  private sourceMap: SourceMap
  private history: HistoryEntry[] = []
  private redoHistory: HistoryEntry[] = []
  private rootCounter: number
  private revisionValue = 0
  private baseline: string
  private baselineSha: string

  constructor(envelope: FileEnvelope, options: SourceBufferOptions = {}) {
    this.envelope = envelope
    this.original = envelope.source
    this.text = envelope.source
    this.baseline = envelope.source
    this.baselineSha = envelope.originalSha256
    this.sourceMap =
      options.map && options.map.source === envelope.source
        ? options.map
        : buildSourceMap(envelope.source)
    this.rootCounter = this.computeNextRootId(this.sourceMap.roots)
  }

  get current(): string {
    return this.text
  }

  /** Last content that was saved or opened; the basis for "unsaved changes". */
  get savedText(): string {
    return this.baseline
  }

  get revision(): number {
    return this.revisionValue
  }

  get map(): SourceMap {
    return this.sourceMap
  }

  get roots(): SourceSpan[] {
    return this.sourceMap.roots
  }

  get baselineSha256(): string {
    return this.baselineSha
  }

  get dirty(): boolean {
    return this.text !== this.baseline
  }

  get canUndo(): boolean {
    return this.history.length > 0
  }

  get canRedo(): boolean {
    return this.redoHistory.length > 0
  }

  get mapIssues() {
    return this.sourceMap.issues
  }

  applyEdits(edits: SourceEdit[], level: PatchLevel): ApplyResult {
    return this.run(edits, level, true)
  }

  undo(): ApplyResult {
    const entry = this.history.pop()
    if (!entry) {
      return { level: 'S0', applied: false, revision: this.revisionValue, dirty: [] }
    }

    const result = this.run(entry.inverse, entry.level, false)
    this.redoHistory.push(entry)
    return result
  }

  redo(): ApplyResult {
    const entry = this.redoHistory.pop()
    if (!entry) {
      return { level: 'S0', applied: false, revision: this.revisionValue, dirty: [] }
    }

    const result = this.run(entry.edits, entry.level, false)
    this.history.push(entry)
    return result
  }

  markSaved(): string {
    const bytes = encodeEnvelope(this.envelope, this.text)
    this.baseline = this.text
    this.baselineSha = sha256(bytes)
    return this.baselineSha
  }

  currentBytes(): Uint8Array {
    return encodeEnvelope(this.envelope, this.text)
  }

  findSpan(id: string): SourceSpan | undefined {
    return this.sourceMap.byId.get(id)
  }

  private run(edits: SourceEdit[], level: PatchLevel, record: boolean): ApplyResult {
    const normalized = this.normalizeEdits(edits)
    if (normalized.length === 0) {
      return { level: 'S0', applied: false, revision: this.revisionValue, dirty: [] }
    }

    const before = this.text
    const after = applyToText(before, normalized)
    if (after === before) {
      return { level: 'S0', applied: false, revision: this.revisionValue, dirty: [] }
    }

    const next = this.rebuild(before, after, normalized)
    const inverse = inverseEdits(before, normalized)

    this.text = after
    this.sourceMap = next
    this.revisionValue += 1

    if (record) {
      this.history.push({ edits: normalized, inverse, level, before, after })
      this.redoHistory = []
    }

    return {
      level,
      applied: true,
      revision: this.revisionValue,
      dirty: newDirtyRanges(normalized),
    }
  }

  private normalizeEdits(edits: SourceEdit[]): SourceEdit[] {
    const sorted = [...edits]
      .filter(edit => edit.insert.length > 0 || edit.to > edit.from)
      .sort((left, right) => left.from - right.from || left.to - right.to)

    let cursor = 0
    for (const edit of sorted) {
      if (edit.from < 0 || edit.to < edit.from || edit.to > this.text.length) {
        throw new Error(`Edit out of bounds: ${edit.from}-${edit.to}`)
      }
      if (edit.from < cursor) {
        throw new Error(`Overlapping edits at ${edit.from}`)
      }
      cursor = edit.to
    }

    return sorted
  }

  private rebuild(before: string, after: string, edits: SourceEdit[]): SourceMap {
    const oldRoots = this.sourceMap.roots
    let regionFromIndex = -1
    let regionToIndex = -1

    for (const edit of edits) {
      const indexes = rootIndexesForEdit(oldRoots, edit)
      if (indexes.from === -1) {
        continue
      }
      if (regionFromIndex === -1 || indexes.from < regionFromIndex) {
        regionFromIndex = indexes.from
      }
      if (regionToIndex === -1 || indexes.to > regionToIndex) {
        regionToIndex = indexes.to
      }
    }

    if (regionFromIndex === -1 || oldRoots.length === 0) {
      const fresh = buildSourceMap(after)
      this.assertValid(fresh)
      this.rootCounter = this.computeNextRootId(fresh.roots)
      return fresh
    }

    const regionStart = oldRoots[regionFromIndex]!.start
    const regionEnd = oldRoots[regionToIndex]!.end
    const delta = after.length - before.length
    const newRegionEnd = regionEnd + delta
    const oldAffected = oldRoots.slice(regionFromIndex, regionToIndex + 1)
    const local = buildSourceMap(after.slice(regionStart, newRegionEnd))
    this.assertValid(local)
    const newRoots: SourceSpan[] = []

    for (let index = 0; index < local.roots.length; index += 1) {
      const localRoot = local.roots[index]!
      const finalId = index < oldAffected.length ? oldAffected[index]!.id : `s${this.rootCounter++}`
      shiftAndReprefix(localRoot, regionStart, localRoot.id, finalId)
      newRoots.push(localRoot)
    }

    const roots: SourceSpan[] = [
      ...oldRoots.slice(0, regionFromIndex),
      ...newRoots,
      ...oldRoots.slice(regionToIndex + 1),
    ]

    if (delta !== 0) {
      for (let index = regionFromIndex + newRoots.length; index < roots.length; index += 1) {
        shiftInPlace(roots[index]!, delta)
      }
    }

    // Only the edited region is rebuilt; keep the global index in place so a
    // keystroke costs work proportional to the changed block, not the document.
    const byId = this.sourceMap.byId
    for (const root of oldAffected) {
      for (const span of walkSpans([root])) {
        byId.delete(span.id)
      }
    }
    for (const root of newRoots) {
      for (const span of walkSpans([root])) {
        byId.set(span.id, span)
      }
    }

    const map: SourceMap = {
      source: after,
      roots,
      byId,
      issues: local.issues,
    }

    this.assertAssembled(map)
    return map
  }

  private assertAssembled(map: SourceMap): void {
    let cursor = 0
    for (const root of map.roots) {
      if (root.start !== cursor) {
        throw new Error(
          `SourceBuffer rebuild produced a root gap at ${root.start}, expected ${cursor}`,
        )
      }
      cursor = root.end
    }
    if (cursor !== map.source.length) {
      throw new Error(
        `SourceBuffer rebuild covered ${cursor} of ${map.source.length} characters`,
      )
    }
  }

  private assertValid(map: SourceMap): void {
    const issues = validateSourceMap(map)
    if (issues.length > 0) {
      throw new Error(
        `SourceBuffer rebuild produced an invalid map: ${issues.map(issue => issue.code).join(', ')}`,
      )
    }
  }

  private computeNextRootId(roots: SourceSpan[]): number {
    let max = -1
    for (const span of walkSpans(roots)) {
      if (/^s\d+$/.test(span.id)) {
        max = Math.max(max, Number(span.id.slice(1)))
      }
    }
    return max + 1
  }
}

function applyToText(text: string, edits: SourceEdit[]): string {
  let result = ''
  let cursor = 0

  for (const edit of edits) {
    result += text.slice(cursor, edit.from)
    result += edit.insert
    cursor = edit.to
  }

  return result + text.slice(cursor)
}

function inverseEdits(before: string, edits: SourceEdit[]): SourceEdit[] {
  const inverse: SourceEdit[] = []
  let delta = 0

  for (const edit of edits) {
    const from = edit.from + delta
    inverse.push({
      from,
      to: from + edit.insert.length,
      insert: before.slice(edit.from, edit.to),
    })
    delta += edit.insert.length - (edit.to - edit.from)
  }

  return inverse
}

function newDirtyRanges(edits: SourceEdit[]): EditRange[] {
  const ranges: EditRange[] = []
  let delta = 0

  for (const edit of edits) {
    const from = edit.from + delta
    ranges.push({ from, to: from + edit.insert.length })
    delta += edit.insert.length - (edit.to - edit.from)
  }

  return ranges
}

function rootIndexesForEdit(
  roots: SourceSpan[],
  edit: SourceEdit,
): { from: number; to: number } {
  let from = -1
  let to = -1

  if (edit.from === edit.to) {
    // An insertion exactly on a root boundary belongs to the adjacent content
    // block, never to a whitespace gap, so the block is not split in two.
    let index = roots.findIndex(
      root => root.start <= edit.from && edit.from < root.end,
    )
    if (index === -1) {
      index = roots.length - 1
    }
    const root = roots[index]
    if (root?.kind === 'gap' && root.start === edit.from && index > 0) {
      const previous = roots[index - 1]!
      if (previous.kind !== 'gap') {
        index -= 1
      }
    }
    return index === -1
      ? { from: -1, to: -1 }
      : { from: index, to: index }
  }

  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index]!
    const intersects = root.end > edit.from && root.start < edit.to

    if (intersects) {
      if (from === -1) {
        from = index
      }
      to = index
    }
  }

  if (from === -1 && roots.length > 0) {
    from = roots.length - 1
    to = roots.length - 1
  }

  return { from, to }
}

function shiftInPlace(span: SourceSpan, delta: number): void {
  span.start += delta
  span.end += delta
  span.contentStart += delta
  span.contentEnd += delta

  for (const child of span.children ?? []) {
    shiftInPlace(child, delta)
  }
}

function shiftAndReprefix(
  span: SourceSpan,
  delta: number,
  localRootId: string,
  finalRootId: string,
): void {
  const mapId = (id: string | undefined): string | undefined => {
    if (!id) {
      return id
    }
    if (id === localRootId) {
      return finalRootId
    }
    if (id.startsWith(`${localRootId}.`)) {
      return `${finalRootId}${id.slice(localRootId.length)}`
    }
    return id
  }

  span.id = mapId(span.id)!
  span.parentId = mapId(span.parentId)
  span.start += delta
  span.end += delta
  span.contentStart += delta
  span.contentEnd += delta

  for (const child of span.children ?? []) {
    shiftAndReprefix(child, delta, localRootId, finalRootId)
  }
}
