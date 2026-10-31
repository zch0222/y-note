import type { BlockAnalysis, SourceAnalysis } from '../source/analysis.js'
import type { SourceMapSnapshot } from '../source/SourceMap.js'

export type AnalysisRequest =
  | { id: number; kind: 'index'; text: string }
  | { id: number; kind: 'analyze'; before: string; after: string }
  | { id: number; kind: 'blocks'; before: string; after: string }

export type AnalysisResponse =
  | { id: number; ok: true; kind: 'index'; map: SourceMapSnapshot }
  | { id: number; ok: true; kind: 'analyze'; result: SourceAnalysis }
  | { id: number; ok: true; kind: 'blocks'; result: BlockAnalysis }
  | { id: number; ok: false; error: string }
