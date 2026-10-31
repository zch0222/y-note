export type SourceEncoding =
  | 'utf-8'
  | 'utf-8-bom'
  | 'utf-16le'
  | 'utf-16be'
  | 'gb18030'

export type EolStyle = 'LF' | 'CRLF' | 'CR' | 'mixed'

export type TrailingBytes = 'none' | 'single-newline' | 'original'

export type ReadOnlyReason =
  | 'unsupported-encoding'
  | 'lossy-decode'
  | 'unrepresentable-content'

export interface FileEnvelope {
  path: string
  encoding: SourceEncoding
  eol: EolStyle
  trailingBytes: TrailingBytes
  originalSha256: string
  source: string
  readOnlyReason?: ReadOnlyReason
}

export type SpanKind = 'block' | 'inline' | 'delimiter' | 'raw' | 'gap'

export type HeadingStyle = 'atx' | 'setext'

export interface SpanAttrs {
  value?: string
  headingLevel?: number
  headingStyle?: HeadingStyle
  marker?: string
  ordered?: boolean
  listStart?: number
  task?: boolean
  checked?: boolean
  lang?: string
  fence?: string
  href?: string
  title?: string
  src?: string
  alt?: string
  align?: Array<'left' | 'right' | 'center' | null>
  cellAlign?: 'left' | 'right' | 'center' | null
  header?: boolean
  row?: number
  column?: number
  lineBreak?: boolean
  unsafe?: boolean
}

export interface SourceSpan {
  id: string
  kind: SpanKind
  start: number
  end: number
  contentStart: number
  contentEnd: number
  parentId?: string
  raw: string
  fingerprint: string
  tokenType?: string
  prefixRaw?: string
  suffixRaw?: string
  attrs?: SpanAttrs
  children?: SourceSpan[]
}

export interface SourceMapIssue {
  code: string
  message: string
  offset?: number
}

export interface SourceMap {
  source: string
  roots: SourceSpan[]
  byId: Map<string, SourceSpan>
  issues: SourceMapIssue[]
}

export interface SourceEdit {
  from: number
  to: number
  insert: string
}

export type PatchLevel = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5'

export interface EditRange {
  from: number
  to: number
}

export interface ApplyResult {
  level: PatchLevel
  applied: boolean
  /** -1 when no revision was created. */
  revision: number
  dirty: EditRange[]
  reason?: string
}

export interface PatchResult extends ApplyResult {
  affectedSpanIds: string[]
  requiresSourceEdit?: boolean
}
