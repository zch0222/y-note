import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import type { ReactNode } from 'react'

import type { MarkName } from '../editor/bridge.js'
import type { DocState } from '../state/store.js'
import { useAppStore } from '../state/useStore.js'
import { Icon } from './Icon.js'

interface ActiveState {
  bold: boolean
  italic: boolean
  strike: boolean
  code: boolean
  link: boolean
  bulletList: boolean
  orderedList: boolean
  blockquote: boolean
  codeBlock: boolean
  headingLevel: number
}

const INACTIVE: ActiveState = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  link: false,
  bulletList: false,
  orderedList: false,
  blockquote: false,
  codeBlock: false,
  headingLevel: 0,
}

function ToolButton({
  title,
  active,
  disabled,
  onClick,
  children,
  className,
}: {
  title: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      className={`tool${active ? ' active' : ''}${className ? ` ${className}` : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={event => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function runMark(editor: Editor | null, store: ReturnType<typeof useAppStore>, mark: MarkName) {
  if (!editor) {
    return
  }
  if (store.bridge && !editor.state.selection.empty && store.bridge.toggleMark(mark)) {
    return
  }
  const chain = editor.chain().focus()
  switch (mark) {
    case 'bold':
      chain.toggleBold().run()
      break
    case 'italic':
      chain.toggleItalic().run()
      break
    case 'strike':
      chain.toggleStrike().run()
      break
    case 'code':
      chain.toggleCode().run()
      break
  }
}

function setBlock(editor: Editor | null, store: ReturnType<typeof useAppStore>, level: number) {
  if (!editor) {
    return
  }
  if (store.bridge?.setBlockType(level)) {
    return
  }
  const chain = editor.chain().focus()
  if (level === 0) {
    chain.setParagraph().run()
  } else {
    chain.setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run()
  }
}

function setLink(editor: Editor | null) {
  if (!editor) {
    return
  }
  const current = String(editor.getAttributes('link').href ?? '')
  const href = window.prompt('链接地址（留空移除链接）', current || 'https://')
  if (href === null) {
    return
  }
  const trimmed = href.trim()
  if (trimmed === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
}

export function Toolbar({ doc }: { doc: DocState }) {
  const store = useAppStore()
  const editor = store.editor
  const readOnly = Boolean(doc.readOnly)
  const locked = !editor || readOnly

  const active =
    useEditorState({
      editor,
      selector: ({ editor: current }): ActiveState => {
        if (!current) {
          return INACTIVE
        }
        return {
          bold: current.isActive('bold'),
          italic: current.isActive('italic'),
          strike: current.isActive('strike'),
          code: current.isActive('code'),
          link: current.isActive('link'),
          bulletList: current.isActive('bulletList'),
          orderedList: current.isActive('orderedList'),
          blockquote: current.isActive('blockquote'),
          codeBlock: current.isActive('codeBlock'),
          headingLevel: current.isActive('heading')
            ? Number(current.getAttributes('heading').level ?? 1)
            : 0,
        }
      },
    }) ?? INACTIVE

  return (
    <div className="format-toolbar" aria-label="格式工具栏">
      <label className="block-select-wrap" title="段落样式">
        <select
          className="block-select"
          value={active.headingLevel}
          disabled={locked}
          onChange={event => setBlock(editor, store, Number(event.target.value))}
          aria-label="段落样式"
        >
          <option value={0}>正文</option>
          <option value={1}>标题 1</option>
          <option value={2}>标题 2</option>
          <option value={3}>标题 3</option>
        </select>
        <Icon name="down" size="small" />
      </label>
      <div className="toolbar-divider" />
      <ToolButton
        title="粗体 (Ctrl/Cmd + B)"
        className="bold"
        active={active.bold}
        disabled={locked}
        onClick={() => runMark(editor, store, 'bold')}
      >
        B
      </ToolButton>
      <ToolButton
        title="斜体 (Ctrl/Cmd + I)"
        className="italic"
        active={active.italic}
        disabled={locked}
        onClick={() => runMark(editor, store, 'italic')}
      >
        I
      </ToolButton>
      <ToolButton
        title="删除线 (Ctrl/Cmd + Shift + X)"
        className="strike"
        active={active.strike}
        disabled={locked}
        onClick={() => runMark(editor, store, 'strike')}
      >
        S
      </ToolButton>
      <ToolButton
        title="链接"
        active={active.link}
        disabled={locked}
        onClick={() => setLink(editor)}
      >
        <Icon name="link" size="small" />
      </ToolButton>
      <ToolButton
        title="行内代码 (Ctrl/Cmd + E)"
        active={active.code}
        disabled={locked}
        onClick={() => runMark(editor, store, 'code')}
      >
        <Icon name="code" size="small" />
      </ToolButton>
      <div className="toolbar-divider" />
      <ToolButton
        title="无序列表"
        active={active.bulletList}
        disabled={locked}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <Icon name="list" size="small" />
      </ToolButton>
      <ToolButton
        title="有序列表"
        active={active.orderedList}
        disabled={locked}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <Icon name="orderedList" size="small" />
      </ToolButton>
      <ToolButton
        title="引用"
        active={active.blockquote}
        disabled={locked}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <Icon name="quote" size="small" />
      </ToolButton>
      <ToolButton
        title="代码块"
        active={active.codeBlock}
        disabled={locked}
        onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
      >
        <Icon name="code" size="small" />
      </ToolButton>
      <ToolButton title="表格结构编辑将在后续里程碑提供" disabled>
        <Icon name="table" size="small" />
      </ToolButton>
      <ToolButton title="图片插入将在后续里程碑提供" disabled>
        <Icon name="image" size="small" />
      </ToolButton>
      <div className="toolbar-spacer" />
      <div className="mode-switch" aria-label="编辑模式">
        <button
          type="button"
          className={store.mode === 'visual' ? 'active' : ''}
          disabled={readOnly}
          title={readOnly ? '只读文档不能切换到编辑视图' : '所见即所得'}
          onClick={() => store.setMode('visual')}
        >
          所见即所得
        </button>
        <button
          type="button"
          className={store.mode === 'source' ? 'active' : ''}
          title="源码（Ctrl/Cmd + Shift + E）"
          onClick={() => store.setMode('source')}
        >
          源码
        </button>
      </div>
    </div>
  )
}
