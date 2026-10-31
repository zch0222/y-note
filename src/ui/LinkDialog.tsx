import type { Editor } from '@tiptap/core'
import { useState } from 'react'

import { isSafeLinkTarget } from '../platform/external.js'
import { Modal } from './Modal.js'

export function LinkDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const current = String(editor.getAttributes('link').href ?? '')
  const [value, setValue] = useState(current)
  const [error, setError] = useState<string | null>(null)
  const hasLink = editor.isActive('link') || current.length > 0

  const remove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    onClose()
  }

  const apply = () => {
    const trimmed = value.trim()
    if (!trimmed) {
      remove()
      return
    }
    if (!isSafeLinkTarget(trimmed)) {
      setError('只支持 http、https、mailto、相对路径或 # 锚点。')
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
    onClose()
  }

  return (
    <Modal
      title={hasLink ? '编辑链接' : '插入链接'}
      description="链接会写入 Markdown 原文；外部链接只在系统浏览器中打开。"
      onClose={onClose}
      className="link-modal"
    >
      <label className="link-field">
        <span>链接地址</span>
        <input
          data-autofocus
          type="text"
          inputMode="url"
          value={value}
          placeholder="https://example.com 或 ./notes/other.md"
          onChange={event => {
            setValue(event.target.value)
            setError(null)
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              apply()
            }
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'link-error' : undefined}
        />
      </label>
      {error ? (
        <p className="link-error" id="link-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="modal-actions">
        {hasLink ? (
          <button className="button" type="button" onClick={remove}>
            移除链接
          </button>
        ) : null}
        <button className="button" type="button" onClick={onClose}>
          取消
        </button>
        <button className="button primary" type="button" onClick={apply}>
          应用
        </button>
      </div>
    </Modal>
  )
}
