import { DEMO_SOURCE } from './demo.js'
import { sha256 } from './source/encoding.js'
import type { AppStore, EditorMode } from './state/store.js'

export interface DebugApi {
  store: AppStore
  openDemo: (source?: string, name?: string) => Promise<void>
  save: () => Promise<void>
  reload: () => Promise<void>
  setMode: (mode: EditorMode) => void
  focus: () => void
  source: () => string | null
  original: () => string | null
  hashes: () => Promise<{
    path: string
    baseline: string
    current: string
    disk: string | null
  } | null>
}

declare global {
  interface Window {
    __YNOTE_DEBUG__?: DebugApi
  }
}

export function installDebug(store: AppStore): void {
  window.__YNOTE_DEBUG__ = {
    store,
    openDemo: (source, name) =>
      store.openDemo(source ?? DEMO_SOURCE, name ?? 'y-note-demo.md'),
    save: () => store.save(),
    reload: () => store.reloadFromDisk(),
    setMode: mode => store.setMode(mode),
    focus: () => {
      if (store.editor) {
        store.editor.commands.focus()
        return
      }
      document.querySelector<HTMLTextAreaElement>('[data-testid="source-editor"]')?.focus()
    },
    source: () => store.doc?.buffer.current ?? null,
    original: () => store.doc?.buffer.original ?? null,
    hashes: async () => {
      const doc = store.doc
      if (!doc) {
        return null
      }
      return {
        path: doc.path,
        baseline: doc.buffer.baselineSha256,
        current: sha256(doc.buffer.currentBytes()),
        disk: await store.gateway.hashFile(doc.path),
      }
    },
  }
}
