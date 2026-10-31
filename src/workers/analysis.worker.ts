import { analyzeBlockChanges, analyzeSourceChanges } from '../source/analysis.js'
import { buildSourceMap, sourceMapSnapshot } from '../source/SourceMap.js'
import type { AnalysisRequest, AnalysisResponse } from './protocol.js'

const scope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<AnalysisRequest>) => void) => void
  postMessage: (message: AnalysisResponse) => void
}

scope.addEventListener('message', event => {
  const request = event.data
  try {
    if (request.kind === 'index') {
      const map = sourceMapSnapshot(buildSourceMap(request.text))
      scope.postMessage({ id: request.id, ok: true, kind: 'index', map })
      return
    }
    if (request.kind === 'analyze') {
      const result = analyzeSourceChanges(request.before, request.after)
      scope.postMessage({ id: request.id, ok: true, kind: 'analyze', result })
      return
    }
    const result = analyzeBlockChanges(request.before, request.after)
    scope.postMessage({ id: request.id, ok: true, kind: 'blocks', result })
  } catch (error) {
    scope.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
