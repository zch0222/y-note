import { useAppStore } from '../state/useStore.js'
import { DocumentHeader } from './DocumentHeader.js'
import { EditorNotices } from './EditorNotices.js'
import { SourceEditor } from './SourceEditor.js'
import { Toolbar } from './Toolbar.js'
import { VisualEditor } from './VisualEditor.js'
import { Welcome } from './Welcome.js'

export function EditorPane() {
  const store = useAppStore()
  const doc = store.doc

  if (!doc) {
    return (
      <main className="editor-pane editor-empty" id="editor-pane" tabIndex={-1} aria-label="编辑区">
        <Welcome />
      </main>
    )
  }

  const sourceMode = store.mode === 'source' || Boolean(doc.readOnly)

  return (
    <main
      className={`editor-pane${sourceMode ? ' source-mode' : ''}`}
      id="editor-pane"
      tabIndex={-1}
      aria-label="编辑区"
    >
      <DocumentHeader doc={doc} />
      <Toolbar doc={doc} />
      <EditorNotices doc={doc} />
      {sourceMode ? (
        <div className="source-view">
          <SourceEditor doc={doc} />
        </div>
      ) : (
        <div className="editor-scroll" id="editor-scroll">
          <div className="document visual-document">
            <VisualEditor key={doc.loadId} doc={doc} />
          </div>
        </div>
      )}
    </main>
  )
}
