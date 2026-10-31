import { useAppStore } from '../state/useStore.js'
import { Icon } from './Icon.js'

const SAVE_LABEL = {
  saved: '已保存',
  dirty: '未保存',
  saving: '保存中',
  error: '保存失败',
} as const

export function TitleBar() {
  const store = useAppStore()
  const doc = store.doc
  const state = doc?.saveState ?? 'saved'

  return (
    <header className="titlebar">
      <div className="title-left">
        <span className="workspace-name">{store.workspace?.name ?? 'y-note'}</span>
        <span className="title-separator">/</span>
        <span className="title-file">{doc?.name ?? '未打开文档'}</span>
      </div>
      <div className="title-center">
        {doc ? (
          <>
            <span className="save-state">
              <span className={`dot ${state}`} />
              {SAVE_LABEL[state]}
            </span>
            <span className="title-divider" />
            <button
              className="clean-link"
              type="button"
              onClick={() => store.setInspectorTab('diff')}
              title="查看源码差异"
            >
              Clean Diff · {doc.dirty ? '待保存' : '干净'}
            </button>
          </>
        ) : (
          <span>{store.gateway.kind === 'tauri' ? '本地优先 · 原始源码是唯一事实' : '浏览器预览'}</span>
        )}
      </div>
      <div className="title-actions">
        {doc ? (
          <button
            className="icon-button"
            type="button"
            title="保存 (Ctrl/Cmd + S)"
            aria-label="保存"
            onClick={() => void store.save()}
          >
            <Icon name="save" size="small" />
          </button>
        ) : null}
        <button
          className="icon-button"
          type="button"
          title="切换明暗主题"
          aria-label="切换明暗主题"
          onClick={() => store.toggleTheme()}
        >
          <Icon name={store.theme === 'light' ? 'moon' : 'sun'} />
        </button>
        <button
          className={`icon-button${store.panelOpen ? ' active' : ''}`}
          type="button"
          title="切换上下文面板"
          aria-label="切换上下文面板"
          onClick={() => store.togglePanel()}
        >
          <Icon name="side" />
        </button>
      </div>
    </header>
  )
}
