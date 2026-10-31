export interface SourceView {
  text: string
  starts: number[]
  ends: number[]
}

export interface AbsoluteRange {
  start: number
  end: number
}

export function viewForSource(source: string): SourceView {
  let text = ''
  const starts: number[] = []
  const ends: number[] = []

  for (let index = 0; index < source.length; ) {
    const char = source[index]
    if (char === '\r') {
      const length = source[index + 1] === '\n' ? 2 : 1
      text += '\n'
      starts.push(index)
      ends.push(index + length)
      index += length
    } else {
      text += char
      starts.push(index)
      ends.push(index + 1)
      index += 1
    }
  }

  return { text, starts, ends }
}

export function sliceView(view: SourceView, from: number, to: number): SourceView {
  return {
    text: view.text.slice(from, to),
    starts: view.starts.slice(from, to),
    ends: view.ends.slice(from, to),
  }
}

export function rangeOf(view: SourceView, from: number, to: number, fallback: number): AbsoluteRange {
  if (to > from) {
    return { start: view.starts[from]!, end: view.ends[to - 1]! }
  }
  return { start: boundaryOf(view, from, fallback), end: boundaryOf(view, from, fallback) }
}

export function boundaryOf(view: SourceView, index: number, fallback: number): number {
  if (view.starts.length === 0) {
    return fallback
  }
  if (index <= 0) {
    return view.starts[0]!
  }
  if (index >= view.starts.length) {
    return view.ends[view.ends.length - 1]!
  }
  return view.starts[index]!
}

export function sourceExact(view: SourceView, from: number, to: number): boolean {
  for (let index = from; index < to; index += 1) {
    if (view.ends[index]! - view.starts[index]! !== 1) {
      return false
    }
    if (index > from && view.starts[index] !== view.ends[index - 1]) {
      return false
    }
  }

  return true
}

export function stripLines(
  view: SourceView,
  from: number,
  to: number,
  stripForLine: (line: string, lineIndex: number) => number,
): SourceView {
  let text = ''
  const starts: number[] = []
  const ends: number[] = []
  let cursor = from
  let lineIndex = 0

  while (cursor < to) {
    const newline = view.text.indexOf('\n', cursor)
    const lineEnd = newline === -1 || newline > to ? to : newline
    const lineText = view.text.slice(cursor, lineEnd)
    const strip = Math.max(0, Math.min(stripForLine(lineText, lineIndex), lineText.length))

    for (let index = cursor + strip; index < lineEnd; index += 1) {
      text += view.text[index]
      starts.push(view.starts[index]!)
      ends.push(view.ends[index]!)
    }

    if (newline !== -1 && newline < to) {
      text += '\n'
      starts.push(view.starts[newline]!)
      ends.push(view.ends[newline]!)
      cursor = newline + 1
    } else {
      cursor = to
    }
    lineIndex += 1
  }

  return { text, starts, ends }
}

export function lineRanges(view: SourceView): AbsoluteRange[] {
  const ranges: AbsoluteRange[] = []
  let from = 0

  for (let index = 0; index <= view.text.length; index += 1) {
    if (index === view.text.length || view.text[index] === '\n') {
      if (index > from) {
        ranges.push({ start: view.starts[from]!, end: view.ends[index - 1]! })
      }
      from = index + 1
    }
  }

  return ranges
}
