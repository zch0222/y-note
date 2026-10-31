import {
  analyzeBlockChanges,
  analyzeSourceChanges,
  type BlockAnalysis,
  type SourceAnalysis,
} from '../source/analysis.js'
import {
  buildSourceMap,
  sourceMapFromSnapshot,
  type SourceMapSnapshot,
} from '../source/SourceMap.js'
import type { SourceMap } from '../source/types.js'
import type { AnalysisRequest, AnalysisResponse } from './protocol.js'

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

function createWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return null
  }
  try {
    return new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
}

export class AnalysisClient {
  private worker: Worker | null = null
  private pending = new Map<number, Pending>()
  private nextId = 0

  constructor() {
    this.worker = createWorker()
    this.worker?.addEventListener('message', this.handleMessage)
    this.worker?.addEventListener('error', this.handleError)
  }

  get runsInWorker(): boolean {
    return this.worker !== null
  }

  indexSource(text: string): Promise<SourceMap> {
    if (!this.worker) {
      return Promise.resolve(buildSourceMap(text))
    }
    return this.request<SourceMapSnapshot>({ kind: 'index', text })
      .then(snapshot => sourceMapFromSnapshot(snapshot))
      .catch(() => buildSourceMap(text))
  }

  analyzeSourceChanges(before: string, after: string): Promise<SourceAnalysis> {
    if (!this.worker) {
      return Promise.resolve(analyzeSourceChanges(before, after))
    }
    return this.request<SourceAnalysis>({ kind: 'analyze', before, after }).catch(() =>
      analyzeSourceChanges(before, after),
    )
  }

  analyzeBlocks(before: string, after: string): Promise<BlockAnalysis> {
    if (!this.worker) {
      return Promise.resolve(analyzeBlockChanges(before, after))
    }
    return this.request<BlockAnalysis>({ kind: 'blocks', before, after }).catch(() =>
      analyzeBlockChanges(before, after),
    )
  }

  dispose(): void {
    this.worker?.removeEventListener('message', this.handleMessage)
    this.worker?.removeEventListener('error', this.handleError)
    this.worker?.terminate()
    this.worker = null
    for (const pending of this.pending.values()) {
      pending.reject(new Error('analysis-worker-disposed'))
    }
    this.pending.clear()
  }

  private request<T>(
    payload:
      | { kind: 'index'; text: string }
      | { kind: 'analyze'; before: string; after: string }
      | { kind: 'blocks'; before: string; after: string },
  ): Promise<T> {
    const worker = this.worker
    if (!worker) {
      return Promise.reject(new Error('analysis-worker-unavailable'))
    }

    const id = this.nextId + 1
    this.nextId = id
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      try {
        worker.postMessage({ ...payload, id } as AnalysisRequest)
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private handleMessage = (event: MessageEvent<AnalysisResponse>): void => {
    const response = event.data
    const pending = this.pending.get(response.id)
    if (!pending) {
      return
    }
    this.pending.delete(response.id)
    if (!response.ok) {
      pending.reject(new Error(response.error))
      return
    }
    switch (response.kind) {
      case 'index':
        pending.resolve(response.map)
        return
      case 'analyze':
        pending.resolve(response.result)
        return
      case 'blocks':
        pending.resolve(response.result)
    }
  }

  private handleError = (): void => {
    const worker = this.worker
    this.worker = null
    worker?.terminate()
    for (const pending of this.pending.values()) {
      pending.reject(new Error('analysis-worker-failed'))
    }
    this.pending.clear()
  }
}
