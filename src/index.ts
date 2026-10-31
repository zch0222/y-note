export type {
  ApplyResult,
  EditRange,
  EolStyle,
  FileEnvelope,
  HeadingStyle,
  PatchLevel,
  PatchResult,
  ReadOnlyReason,
  SourceEdit,
  SourceEncoding,
  SourceMap,
  SourceMapIssue,
  SourceSpan,
  SpanAttrs,
  SpanKind,
  TrailingBytes,
} from './source/types.js'

import './source/node-encoding.js'

export { fingerprint } from './source/hash.js'

export { sha256 as sha256Bytes } from './source/sha256.js'
export { registerGb18030Codec } from './source/encoding.js'
export type { Gb18030Codec } from './source/encoding.js'

export {
  classifyTrailing,
  decodeSource,
  detectEol,
  encodeSource,
  encodeUtf8,
  eolSequenceAt,
  sha256,
  sha256Text,
} from './source/encoding.js'
export type { DecodedSource } from './source/encoding.js'

export {
  encodeEnvelope,
  envelopeRoundTrips,
  openEnvelope,
  openEnvelopeFromText,
} from './source/Envelope.js'

export {
  boundaryOf,
  rangeOf,
  sliceView,
  sourceExact,
  stripLines,
  viewForSource,
} from './source/views.js'
export type { AbsoluteRange, SourceView } from './source/views.js'

export { lexDocument, lexInline } from './source/lexer.js'
export type {
  LexResult,
  LexedToken,
  MarkdownCell,
  MarkdownToken,
} from './source/lexer.js'

export {
  buildSourceMap,
  findSpanById,
  innermostSpanAt,
  reconstructSource,
  topLevelSpanAt,
  validateSourceMap,
  walkSpans,
} from './source/SourceMap.js'

export { SourceBuffer } from './source/SourceBuffer.js'
export type { SourceBufferOptions } from './source/SourceBuffer.js'

export {
  analyzeDelimiterPreferences,
  replaceBlockRaw,
  replaceText,
  setHeadingLevel,
  setListItemMarker,
  setSpanText,
  setTaskChecked,
  toggleMark,
} from './source/patch.js'
export type {
  DelimiterPreferences,
  MarkType,
  ReplaceTextRequest,
  ToggleMarkRequest,
} from './source/patch.js'

export { planSave, saveDocument } from './source/save.js'
export type {
  SaveIO,
  SavePlan,
  SaveResult,
  SaveStatus,
  SaveWriteOptions,
} from './source/save.js'

export { projectDocument } from './source/projection.js'
export type {
  ProjectedDocument,
  ProjectedMark,
  ProjectedNode,
} from './source/projection.js'

export {
  DiskConflictError,
  writeFileAtomic,
} from './source/AtomicFile.js'
export type {
  AtomicWriteOptions,
  AtomicWriteResult,
} from './source/AtomicFile.js'

export { createNodeSaveIO } from './source/node-io.js'
