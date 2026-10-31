import { useEditorState } from '@tiptap/react'
import { useMemo } from 'react'

import { selectionFromHint } from '../editor/bridge.js'
import type { DocState } from '../state/store.js'
import { useAppStore } from '../state/useStore.js'
import { previewSourceDiff } from './diff.js'
import { Icon } from './Icon.js'

const ENCODING_LABEL: Record<string, string> = {
  'utf-8': 'UTF-8',
  'utf-8-bom': 'UTF-8 BOM',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  gb18030: 'GB18030',
}

export function Inspector() {
  const store = useAppStore()
  const doc = store.doc

  return (
    <aside
      className="inspector"
      id="inspector"
      data-panel={store.inspectorTab}
      aria-label="上下文面板"
    >
      <div className="inspector-tabs">
        <button
          className={`inspector-tab${store.inspectorTab === 'outline' ? ' active' : ''}`}
          type="button"
          onClick={() => store.setInspectorTab('outline')}
        >
          大纲
        </button>
        <button
          className={`inspector-tab${store.inspectorTab === 'diff' ? ' active' : ''}`}
          type="button"
          onClick={() => store.setInspectorTab('diff')}
        >
          改动
        </button>
        <div className="inspector-actions">
          <button
            className="icon-button"
            type="button"
            title="关闭面板"
            aria-label="关闭面板"
            onClick={() => store.togglePanel()}
          >
            <Icon name="x" size="small" />
          </button>
        </div>
      </div>
      {doc ? (
        <InspectorDocument doc={doc} />
      ) : (
        <div className="inspector-empty">打开文档后，这里会显示大纲、源块映射与源码差异。</div>
      )}
    </aside>
  )
}

function InspectorDocument({ doc }: { doc: DocState }) {
  const store = useAppStore()
  const editor = store.editor
  const activeIndex =
    useEditorState({
      editor,
      selector: ({ editor: current }) => {
        if (!current) {
          return -1
        }
        const { $from } = current.state.selection
        return $from.depth >= 1 ? $from.index(0) : -1
      },
    }) ?? -1

  const diff = useMemo(
    () => previewSourceDiff(doc.buffer.original, doc.buffer.current),
    [doc.buffer.original, doc.buffer.current],
  )
  const blocks = doc.buffer.map.roots.filter(root => root.kind !== 'gap').length
  const issues = doc.buffer.map.issues.length
  const clean = issues === 0
  const summary =
    doc.external === 'conflict'
      ? '等待处理保存冲突'
      : doc.dirty
        ? '干净 Diff 已守护'
        : '与磁盘基线一致'

  const jumpTo = (index: number) => {
    if (!editor) {
      store.notify('切换到编辑视图后可以跳转大纲。')
      return
    }
    const position = selectionFromHint(editor.state.doc, { blockIndex: index, offset: 0 })
    editor.chain().focus().setTextSelection(position).scrollIntoView().run()
  }

  return (
    <div className="inspector-scroll">
      <div className="outline-panel">
        <section className="panel-section">
          <div className="panel-heading">
            <span>文档大纲</span>
            <span className="plain">{doc.outline.length} 个标题</span>
          </div>
          {doc.outline.length === 0 ? (
            <div className="panel-placeholder">使用 # 标题后，大纲会显示在这里。</div>
          ) : (
            <div className="outline-list">
              {doc.outline.map(item => (
                <div
                  key={`${item.index}-${item.text}`}
                  className={`outline-item${item.level > 1 ? ' sub' : ''}${activeIndex === item.index ? ' active' : ''}`}
                  role="button"
                  tabIndex={0}
                  title={item.text}
                  onClick={() => jumpTo(item.index)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      jumpTo(item.index)
                    }
                  }}
                >
                  <span className="outline-number">H{item.level}</span>
                  {item.text}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel-section">
          <div className="panel-heading">
            <span>源文件映射</span>
            <span className="plain">{ENCODING_LABEL[doc.encoding] ?? doc.encoding}</span>
          </div>
          <div className="current-block-card">
            <div className="block-card-head">
              <div className="block-type">
                <span className="type-icon">¶</span>
                {doc.readOnly ? '只读视图' : '无损源码映射'}
              </div>
              <span
                className="mapping-badge"
                style={clean ? undefined : { color: 'var(--amber)', background: 'var(--amber-soft)' }}
              >
                <Icon name={clean ? 'check' : 'warning'} size="small" style={{ width: 10 }} />
                {clean ? '精确映射' : `${issues} 个降级块`}
              </span>
            </div>
            <div className="mapping-grid">
              <div className="mapping-item">
                <span>保存策略</span>
                <strong>S1 · Text patch</strong>
              </div>
              <div className="mapping-item">
                <span>源块</span>
                <strong>{blocks}</strong>
              </div>
              <div className="mapping-item">
                <span>编码</span>
                <strong>{ENCODING_LABEL[doc.encoding] ?? doc.encoding}</strong>
              </div>
              <div className="mapping-item">
                <span>换行</span>
                <strong>{doc.eol}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="panel-section">
          <div className="clean-card">
            <div className="clean-card-title">
              <span className="clean-check">
                <Icon name={clean ? 'check' : 'warning'} />
              </span>
              {summary}
            </div>
            <p>
              {doc.dirty
                ? '只有真实内容变化会写入；未编辑块、原始定界符与文件外壳保持原样。'
                : '当前缓冲区与磁盘基线一致，保存不会产生任何写入。'}
            </p>
            <div className="format-stats">
              <div className="format-stat">
                <strong>{diff.added}</strong>
                <span>新增行</span>
              </div>
              <div className="format-stat">
                <strong style={{ color: diff.removed > 0 ? 'var(--red)' : undefined }}>
                  {diff.removed}
                </strong>
                <span>移除行</span>
              </div>
              <div className="format-stat">
                <strong>{blocks}</strong>
                <span>源块</span>
              </div>
            </div>
            <button type="button" onClick={() => store.setInspectorTab('diff')}>
              查看本次源码差异 →
            </button>
          </div>
        </section>

        <div className="local-note">
          <Icon name="lock" />
          <span>所有内容仅保存在此设备。草稿与索引不会写入当前仓库。</span>
        </div>
      </div>

      <div className="diff-panel">
        <div className="diff-summary">
          <div className="diff-summary-top">
            <div className="diff-branch">
              <Icon name="git" size="small" />
              本地缓冲区
            </div>
            <div className="diff-count">
              <span className="add">+{diff.added}</span>
              <span className="remove">−{diff.removed}</span>
            </div>
          </div>
          <div className="diff-file">
            <Icon name="file" size="small" />
            <span>{doc.name}</span>
            <span className="file-status">{doc.dirty ? '未保存' : '已同步'}</span>
          </div>
          <div className="diff-progress">
            <span className="add" style={{ width: diff.added > 0 ? '66%' : '0%' }} />
            <span className="remove" style={{ width: diff.removed > 0 ? '34%' : '0%' }} />
          </div>
        </div>

        <div className="panel-heading">
          <span>源文件差异</span>
          <span className="plain">{diff.changed ? '相对打开时基线' : '无改动'}</span>
        </div>

        {diff.changed ? (
          <div className="source-diff">
            <div className="source-diff-head">
              <span>{doc.name}</span>
              <span>
                {ENCODING_LABEL[doc.encoding] ?? doc.encoding} · {doc.eol}
              </span>
            </div>
            <div className="diff-code">
              {diff.rows.map((row, index) =>
                row.kind === 'gap' ? (
                  <div className="diff-gap" key={`gap-${index}`}>
                    ··· {row.text} ···
                  </div>
                ) : (
                  <div className={`diff-line ${row.kind}`} key={`line-${index}`}>
                    <span className="line-no">{row.before ?? row.after ?? ''}</span>
                    <span className="sign">
                      {row.kind === 'removed' ? '−' : row.kind === 'added' ? '+' : ''}
                    </span>
                    <span className="line-text">{row.text === '' ? ' ' : row.text}</span>
                  </div>
                ),
              )}
            </div>
          </div>
        ) : (
          <div className="panel-placeholder">当前缓冲区与打开时基线一致，没有未保存的源码改动。</div>
        )}

        <div className="panel-heading" style={{ marginTop: 18 }}>
          <span>保存前检查</span>
          <span className="plain" style={{ color: 'var(--green)' }}>
            {clean ? '映射完整' : '包含降级块'}
          </span>
        </div>
        <div className="verify-list">
          <div className="verify-row">
            <Icon name="check" />
            编码与 BOM 保持
            <span>{ENCODING_LABEL[doc.encoding] ?? doc.encoding}</span>
          </div>
          <div className="verify-row">
            <Icon name="check" />
            换行风格保持
            <span>{doc.eol}</span>
          </div>
          <div className="verify-row">
            <Icon name={clean ? 'check' : 'warning'} />
            源块映射
            <span>{clean ? `${blocks} 块 / 无降级` : `${issues} 个降级块`}</span>
          </div>
          <div className="verify-row">
            <Icon name="check" />
            磁盘基线摘要
            <span>{doc.buffer.baselineSha256.slice(0, 12)}</span>
          </div>
        </div>

        <div className="diff-actions">
          <button className="button" type="button" onClick={() => void store.reloadFromDisk()}>
            <Icon name="refresh" size="small" />
            重新载入
          </button>
          <button
            className="button primary"
            type="button"
            disabled={Boolean(doc.readOnly)}
            onClick={() => void store.save()}
          >
            <Icon name="save" size="small" />
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
