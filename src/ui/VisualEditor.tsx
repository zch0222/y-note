import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useMemo, useRef } from 'react'

import {
  selectionFromHint,
  selectionRangeFromHint,
} from '../editor/bridge.js'
import { createEditorExtensions } from '../editor/schema.jsx'
import type { DocState } from '../state/store.js'
import { useAppStore } from '../state/useStore.js'

function displayDocument(json: JSONContent): JSONContent {
  if ((json.content?.length ?? 0) > 0) {
    return json
  }
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

export function VisualEditor({ doc }: { doc: DocState }) {
  const store = useAppStore()
  const pathRef = useRef('')

  const extensions = useMemo(
    () =>
      createEditorExtensions({
        toggleMark: mark => store.bridge?.toggleMark(mark) ?? false,
        setBlockType: level => store.bridge?.setBlockType(level) ?? false,
      }),
    [store],
  )

  const editor = useEditor(
    {
      extensions,
      content: displayDocument(doc.tiptap),
      editorProps: {
        attributes: {
          class: 'ProseMirror ynote-prose',
          spellcheck: 'false',
          'aria-label': 'Markdown 编辑器',
        },
      },
    },
    [extensions],
  )

  useEffect(() => {
    if (!editor) {
      return
    }
    store.attachEditor(editor)
    return () => store.detachEditor(editor)
  }, [editor, store])

  useEffect(() => {
    const current = store.doc
    if (!editor || !current) {
      return
    }
    const pathChanged = pathRef.current !== current.path
    pathRef.current = current.path
    const hadFocus = editor.view.hasFocus()
    const previousFrom = editor.state.selection.from

    editor.commands.setContent(displayDocument(current.tiptap), { emitUpdate: false })
    store.bridge?.syncFromEditor(editor.getJSON())

    const size = editor.state.doc.content.size
    if (size > 0) {
      let range = { from: Math.min(previousFrom, size), to: Math.min(previousFrom, size) }
      if (current.hint) {
        range = selectionRangeFromHint(editor.state.doc, current.hint)
      } else if (pathChanged) {
        const position = selectionFromHint(editor.state.doc)
        range = { from: position, to: position }
      }
      editor.commands.setTextSelection(range)
      if (hadFocus || pathChanged) {
        editor.commands.focus()
      }
    }
    current.hint = undefined

    if (pathChanged) {
      const scroll = editor.view.dom.closest('.editor-scroll')
      if (scroll instanceof HTMLElement) {
        scroll.scrollTop = 0
      }
    }
  }, [editor, store, doc.path, doc.epoch])

  return (
    <div className="visual-editor" data-testid="visual-editor">
      <EditorContent editor={editor} />
    </div>
  )
}
