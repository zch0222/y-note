import { useEditorState } from '@tiptap/react'
import { useMemo } from 'react'

import { selectionFromHint } from '../editor/bridge.js'
import type { GitDiff, GitStatus } from '../platform/types.js'
import type { DocState } from '../state/store.js'
import { useAppStore } from '../state/useStore.js'
import { previewSourceDiff } from './diff.js'
import { Icon } from './Icon.js'

const GIT_STATUS_LABEL: Record<GitStatus, string> = {
  clean: '与 HEAD 一致',
  modified: '工作区已修改',
  staged: '已暂存',
  untracked: '未跟踪',
  deleted: '已删除',
  ignored: '已忽略',
  unborn: '尚无提交',
  'not-repo': '非 Git 仓库',
}

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
  const git = store.git
  const summaryAdded = store.diffSource === 'git' ? (git?.additions ?? 0) : diff.added
  const summaryRemoved = store.diffSource === 'git' ? (git?.deletions ?? 0) : diff.removed
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
            <button
              type="button"
              onClick={() => {
                store.setDiffSource('local')
                store.setInspectorTab('diff')
              }}
            >
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
        <div className="diff-source-switch" role="tablist" aria-label="差异来源">
          <button
            type="button"
            role="tab"
            aria-selected={store.diffSource === 'git'}
            className={store.diffSource === 'git' ? 'active' : ''}
            onClick={() => store.setDiffSource('git')}
          >
            Git 差异
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={store.diffSource === 'local'}
            className={store.diffSource === 'local' ? 'active' : ''}
            onClick={() => store.setDiffSource('local')}
          >
            未保存改动
          </button>
        </div>

        <div className="diff-summary">
          <div className="diff-summary-top">
            <div className="diff-branch" title={git?.repoRoot ?? undefined}>
              <Icon name="git" size="small" />
              {store.diffSource === 'git' ? gitBranchLabel(git) : '本地缓冲区'}
            </div>
            <div className="diff-summary-actions">
              <div className="diff-count">
                <span className="add">+{summaryAdded}</span>
                <span className="remove">−{summaryRemoved}</span>
              </div>
              {store.diffSource === 'git' ? (
                <button
                  className="icon-button"
                  type="button"
                  title="刷新 Git 差异"
                  aria-label="刷新 Git 差异"
                  disabled={store.gitLoading}
                  onClick={() => void store.refreshGitDiff()}
                >
                  <Icon name="refresh" size="small" />
                </button>
              ) : null}
            </div>
          </div>
          <div className="diff-file">
            <Icon name="file" size="small" />
            <span>{doc.name}</span>
            <span
              className="file-status"
              style={
                store.diffSource === 'git' && git?.status === 'clean'
                  ? { color: 'var(--green)' }
                  : undefined
              }
            >
              {store.diffSource === 'git'
                ? gitStatusLabel(git, store.gitLoading, store.gitError)
                : doc.dirty
                  ? '未保存'
                  : '已同步'}
            </span>
          </div>
          <div className="diff-progress">
            <span className="add" style={{ width: summaryWidth(summaryAdded, summaryRemoved, true) }} />
            <span className="remove" style={{ width: summaryWidth(summaryAdded, summaryRemoved, false) }} />
          </div>
        </div>

        {store.diffSource === 'git' ? (
          <>
            <div className="panel-heading">
              <span>Git 差异</span>
              <span className="plain">
                {git?.head ? `HEAD ${git.head}` : store.gitLoading ? '读取中…' : '只读'}
              </span>
            </div>
            <GitDiffView
              git={git}
              loading={store.gitLoading}
              error={store.gitError}
              onRefresh={() => void store.refreshGitDiff()}
            />
          </>
        ) : (
          <>
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
          </>
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

function gitBranchLabel(git: GitDiff | null): string {
  if (!git) {
    return 'Git'
  }
  if (git.status === 'not-repo') {
    return '未连接仓库'
  }
  if (git.branch && git.branch !== 'HEAD') {
    return git.branch
  }
  return git.head ? 'detached HEAD' : '尚无提交'
}

function gitStatusLabel(git: GitDiff | null, loading: boolean, error: string | null): string {
  if (error) {
    return '读取失败'
  }
  if (!git) {
    return loading ? '读取中' : '不可用'
  }
  return GIT_STATUS_LABEL[git.status]
}

function summaryWidth(added: number, removed: number, isAdded: boolean): string {
  const total = added + removed
  if (total === 0) {
    return '0%'
  }
  const share = Math.round(((isAdded ? added : removed) / total) * 100)
  return share === 0 ? '0%' : `${Math.max(6, share)}%`
}

function GitDiffView({
  git,
  loading,
  error,
  onRefresh,
}: {
  git: GitDiff | null
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  if (loading && !git) {
    return <div className="panel-placeholder">正在读取 Git 差异…</div>
  }

  if (error) {
    return (
      <div className="git-state">
        <strong>无法读取 Git 差异</strong>
        <span>{error}</span>
        <button className="button" type="button" onClick={onRefresh}>
          重试
        </button>
      </div>
    )
  }

  if (!git) {
    return <div className="panel-placeholder">当前环境不支持 Git 差异。</div>
  }

  if (git.status === 'not-repo') {
    return (
      <div className="git-state">
        <strong>文件不在 Git 仓库中</strong>
        <span>{git.message ?? '初始化 Git 仓库后，这里会显示该文件与 HEAD 的只读差异。'}</span>
      </div>
    )
  }

  if (git.status === 'untracked') {
    return (
      <div className="git-state">
        <strong>文件尚未被 Git 跟踪</strong>
        <span>执行 git add 后，这里会显示该文件与 HEAD 的差异。</span>
      </div>
    )
  }

  if (git.status === 'unborn') {
    return (
      <div className="git-state">
        <strong>仓库尚无提交</strong>
        <span>{git.message ?? '创建首个提交后，这里会显示可比基线。'}</span>
      </div>
    )
  }

  if (git.status === 'ignored') {
    return (
      <div className="git-state">
        <strong>文件被 Git 忽略</strong>
        <span>{git.message ?? '被忽略的文件不会出现在 Git 差异中。'}</span>
      </div>
    )
  }

  if (git.binary) {
    return (
      <div className="git-state">
        <strong>二进制文件</strong>
        <span>Git 将文件视为二进制，无法显示行级差异。</span>
      </div>
    )
  }

  if (git.hunks.length === 0) {
    return (
      <div className="panel-placeholder">
        工作区与该文件的 HEAD 版本一致，没有未提交改动。
      </div>
    )
  }

  return (
    <>
      <div className="git-diff">
        {git.hunks.map((hunk, hunkIndex) => (
          <div className="git-hunk" key={`${hunk.oldStart}-${hunk.newStart}-${hunkIndex}`}>
            <div className="git-hunk-head">
              @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
            </div>
            <div className="diff-code">
              {hunk.lines.map((line, lineIndex) => (
                <div
                  className={`git-diff-line ${line.kind}`}
                  key={`${line.oldLine ?? 'x'}-${line.newLine ?? 'x'}-${lineIndex}`}
                >
                  <span className="line-no">{line.oldLine ?? ''}</span>
                  <span className="line-no">{line.newLine ?? ''}</span>
                  <span className="sign">
                    {line.kind === 'removed' ? '−' : line.kind === 'added' ? '+' : ''}
                  </span>
                  <span className="line-text">{line.text === '' ? ' ' : line.text}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {git.truncated ? (
        <div className="panel-placeholder">差异过大，已截断显示；请用 git diff 查看完整内容。</div>
      ) : null}
    </>
  )
}
