import { useAppStore } from '../state/useStore.js'
import { Icon } from './Icon.js'
import { shortcutAria, shortcutText } from './shortcuts.js'
import { WindowControls } from './WindowControls.js'

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
    <header className="titlebar" data-tauri-drag-region>
      <div className="title-left" data-tauri-drag-region>
        <span className="workspace-name">{store.workspace?.name ?? 'y-note'}</span>
        <span className="title-separator">/</span>
        <span className="title-file">{doc?.name ?? '未打开文档'}</span>
      </div>
      <div className="title-center" data-tauri-drag-region>
        {doc ? (
          <>
            <span className="save-state" aria-live="polite">
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
      <div className="title-right">
        <div className="title-actions">
          <button
            className="icon-button title-command"
            type="button"
            title={`命令面板 (${shortcutText(store.platform, 'Mod+K')})`}
            aria-label="打开命令面板"
            aria-keyshortcuts={shortcutAria(store.platform, 'Mod+K')}
            onClick={() => store.openOverlay('command')}
          >
            <Icon name="command" />
          </button>
          {doc ? (
            <button
              className="icon-button"
              type="button"
              title={`保存 (${shortcutText(store.platform, 'Mod+S')})`}
              aria-label="保存"
              aria-keyshortcuts={shortcutAria(store.platform, 'Mod+S')}
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
            title={`${store.panelOpen ? '隐藏' : '显示'}上下文面板 (${shortcutText(
              store.platform,
              'Mod+Shift+D',
            )})`}
            aria-label={store.panelOpen ? '隐藏上下文面板' : '显示上下文面板'}
            aria-expanded={store.panelOpen}
            aria-controls="inspector"
            aria-keyshortcuts={shortcutAria(store.platform, 'Mod+Shift+D')}
            onClick={() => store.togglePanel()}
          >
            <Icon name="side" />
          </button>
        </div>
        <WindowControls />
      </div>
    </header>
  )
}
