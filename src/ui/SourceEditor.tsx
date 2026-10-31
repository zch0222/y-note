import { useEffect, useRef, useState } from 'react'

import type { DocState } from '../state/store.js'
import { useAppStore } from '../state/useStore.js'

export function SourceEditor({ doc }: { doc: DocState }) {
  const store = useAppStore()
  const [value, setValue] = useState(doc.buffer.current)
  const keyRef = useRef(`${doc.path}:${doc.epoch}`)

  useEffect(() => {
    const key = `${doc.path}:${doc.epoch}`
    if (keyRef.current !== key) {
      keyRef.current = key
      setValue(doc.buffer.current)
    }
  }, [doc.path, doc.epoch, doc.buffer])

  return (
    <div className="source-pane">
      <div className="source-meta">
        <span>
          Markdown 源码 · {doc.encoding.toUpperCase()} · {doc.eol}
        </span>
        <span className="source-meta-note">直接编辑原始字节，保存前不会重新格式化</span>
      </div>
      <textarea
        className="source-textarea"
        data-testid="source-editor"
        aria-label="Markdown 源码"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        readOnly={Boolean(doc.readOnly)}
        value={value}
        onChange={event => {
          const next = event.target.value
          setValue(next)
          store.applySourceText(next)
        }}
        onKeyDown={event => {
          if (event.key !== 'Tab' || doc.readOnly) {
            return
          }
          event.preventDefault()
          const target = event.currentTarget
          const start = target.selectionStart
          const end = target.selectionEnd
          const next = `${value.slice(0, start)}  ${value.slice(end)}`
          setValue(next)
          store.applySourceText(next)
          requestAnimationFrame(() => {
            target.selectionStart = start + 2
            target.selectionEnd = start + 2
          })
        }}
      />
    </div>
  )
}
