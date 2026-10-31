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

const CONTEXT_LINES = 3
const MAX_MIDDLE_LINES = 60

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return []
  }
  return text.split(/\r\n|\n|\r/)
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
