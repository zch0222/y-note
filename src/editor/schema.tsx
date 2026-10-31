import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core'
import { ListItem as BaseListItem } from '@tiptap/extension-list'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import StarterKit from '@tiptap/starter-kit'
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react'
import type { Extensions } from '@tiptap/core'

export type MarkCommand = 'bold' | 'italic' | 'strike' | 'code'

export interface EditorCommandCallbacks {
  toggleMark: (mark: MarkCommand) => boolean
  setBlockType: (level: number) => boolean
}

const SourceAttributes = Extension.create({
  name: 'sourceAttributes',

  addGlobalAttributes() {
    return [
      {
        types: [
          'paragraph',
          'heading',
          'bulletList',
          'orderedList',
          'listItem',
          'blockquote',
          'codeBlock',
          'table',
          'tableRow',
          'tableHeader',
          'tableCell',
          'horizontalRule',
          'image',
          'hardBreak',
        ],
        attributes: {
          sourceId: {
            default: null,
            keepOnSplit: false,
            parseHTML: element => element.getAttribute('data-source-id'),
            renderHTML: attributes =>
              attributes.sourceId ? { 'data-source-id': attributes.sourceId } : {},
          },
        },
      },
      {
        types: ['heading'],
        attributes: {
          headingStyle: {
            default: 'atx',
            parseHTML: element => element.getAttribute('data-heading-style') ?? 'atx',
            renderHTML: attributes =>
              attributes.headingStyle ? { 'data-heading-style': attributes.headingStyle } : {},
          },
        },
      },
      {
        types: ['listItem'],
        attributes: {
          checked: {
            default: null,
            parseHTML: element => {
              const value = element.getAttribute('data-checked')
              return value === null ? null : value === 'true'
            },
            renderHTML: attributes =>
              attributes.checked === null || attributes.checked === undefined
                ? {}
                : { 'data-checked': String(attributes.checked) },
          },
          marker: {
            default: null,
            parseHTML: element => element.getAttribute('data-marker'),
            renderHTML: attributes =>
              attributes.marker ? { 'data-marker': attributes.marker } : {},
          },
        },
      },
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          align: {
            default: null,
            parseHTML: element => element.getAttribute('data-align'),
            renderHTML: attributes =>
              attributes.align ? { 'data-align': attributes.align } : {},
          },
        },
      },
    ]
  },
})

const SourceAnchor = Mark.create({
  name: 'sourceAnchor',
  inclusive: true,
  keepOnSplit: true,
  excludes: '',

  addAttributes() {
    return {
      sourceId: {
        default: null,
        renderHTML: attributes =>
          attributes.sourceId ? { 'data-source-anchor': attributes.sourceId } : {},
      },
    }
  },

  parseHTML() {
    return []
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
})

const YDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'block*',
})

const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      sourceId: { default: null },
      tokenType: { default: 'raw' },
      raw: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-raw-block]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { class: 'raw-block-wrap', 'data-raw-block': '' }),
      [
        'div',
        { class: 'raw-block-head' },
        ['span', { class: 'raw-block-label' }, String(node.attrs.tokenType ?? 'raw')],
        ['span', { class: 'raw-block-note' }, '原样保留 · 局部源码编辑'],
      ],
      ['pre', { class: 'raw-block-source' }, String(node.attrs.raw ?? '')],
    ]
  },
})

const RawInline = Node.create({
  name: 'rawInline',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      sourceId: { default: null },
      tokenType: { default: 'raw' },
      raw: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-raw-inline]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'raw-inline', 'data-raw-inline': '' }),
      String(node.attrs.raw ?? ''),
    ]
  },
})

const FrontMatter = Node.create({
  name: 'frontMatter',
  group: 'block',
  atom: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      sourceId: { default: null },
      raw: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-front-matter]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { class: 'raw-block-wrap front-matter', 'data-front-matter': '' }),
      ['div', { class: 'raw-block-head' }, ['span', { class: 'raw-block-label' }, 'front matter']],
      ['pre', { class: 'raw-block-source' }, String(node.attrs.raw ?? '')],
    ]
  },
})

const LinkReferenceDefinition = Node.create({
  name: 'linkReferenceDefinition',
  group: 'block',
  atom: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      sourceId: { default: null },
      raw: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-link-reference]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'raw-block-wrap link-reference',
        'data-link-reference': '',
      }),
      ['div', { class: 'raw-block-head' }, ['span', { class: 'raw-block-label' }, 'link reference']],
      ['pre', { class: 'raw-block-source' }, String(node.attrs.raw ?? '')],
    ]
  },
})

function TaskListItemView({ node }: NodeViewProps) {
  const checked = node.attrs.checked
  const isTask = checked !== null && checked !== undefined

  return (
    <NodeViewWrapper as="li" className={isTask ? 'task-item' : 'list-item'}>
      {isTask ? (
        <button
          type="button"
          className={`task-checkbox${checked ? ' checked' : ''}`}
          contentEditable={false}
          aria-label={checked ? '标记为未完成' : '标记为已完成'}
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent('ynote:toggle-task', {
                detail: { sourceId: node.attrs.sourceId, checked: !checked },
              }),
            )
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m5 12 4 4L19 6" />
          </svg>
        </button>
      ) : null}
      <NodeViewContent className="list-item-content" />
    </NodeViewWrapper>
  )
}

const YListItem = BaseListItem.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TaskListItemView)
  },
})

export function createEditorExtensions(callbacks: EditorCommandCallbacks): Extensions {
  const SourceShortcuts = Extension.create({
    name: 'sourceShortcuts',
    priority: 1000,

    addKeyboardShortcuts() {
      return {
        'Mod-b': () => callbacks.toggleMark('bold'),
        'Mod-i': () => callbacks.toggleMark('italic'),
        'Mod-e': () => callbacks.toggleMark('code'),
        'Mod-Shift-x': () => callbacks.toggleMark('strike'),
        'Mod-Alt-0': () => callbacks.setBlockType(0),
        'Mod-Alt-1': () => callbacks.setBlockType(1),
        'Mod-Alt-2': () => callbacks.setBlockType(2),
        'Mod-Alt-3': () => callbacks.setBlockType(3),
      }
    },
  })

  return [
    StarterKit.configure({
      document: false,
      listItem: false,
      underline: false,
      trailingNode: false,
      link: {
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
      },
    }),
    YDocument,
    YListItem,
    SourceAttributes,
    SourceAnchor,
    RawBlock,
    RawInline,
    FrontMatter,
    LinkReferenceDefinition,
    Image.configure({
      inline: true,
      allowBase64: true,
      HTMLAttributes: { loading: 'lazy', decoding: 'async' },
    }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    SourceShortcuts,
  ]
}
