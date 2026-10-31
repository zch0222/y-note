import { useAppStore } from '../state/useStore.js'
import { Icon } from './Icon.js'
import { shortcutAria, shortcutText } from './shortcuts.js'

export function ActivityRail() {
  const store = useAppStore()

  return (
    <nav className="activity-rail" aria-label="活动栏">
      <div className="brand" title="Y Note" aria-hidden="true">
        Y
      </div>
      <button
        className={`rail-button${store.sidebarOpen ? ' active' : ''}`}
        type="button"
        title={`${store.sidebarOpen ? '隐藏' : '显示'}文件栏 (${shortcutText(
          store.platform,
          'Mod+Shift+B',
        )})`}
        aria-label={store.sidebarOpen ? '隐藏文件栏' : '显示文件栏'}
        aria-expanded={store.sidebarOpen}
        aria-controls="file-sidebar"
        aria-keyshortcuts={shortcutAria(store.platform, 'Mod+Shift+B')}
        onClick={() => store.toggleSidebar()}
      >
        <Icon name="files" size="large" />
      </button>
      <button
        className="rail-button"
        type="button"
        title={`搜索文件 (${shortcutText(store.platform, 'Mod+P')})`}
        aria-label="搜索文件"
        aria-keyshortcuts={shortcutAria(store.platform, 'Mod+P')}
        onClick={() => document.getElementById('file-search')?.focus()}
      >
        <Icon name="search" size="large" />
      </button>
      <button
        className={`rail-button${store.inspectorTab === 'diff' && store.panelOpen ? ' active' : ''}`}
        type="button"
        title="源码改动"
        aria-label="源码改动"
        aria-expanded={store.panelOpen && store.inspectorTab === 'diff'}
        aria-controls="inspector"
        onClick={() => store.setInspectorTab('diff')}
      >
        <Icon name="git" size="large" />
      </button>
      <div className="rail-spacer" />
      <button
        className="rail-button"
        type="button"
        title={`命令面板 (${shortcutText(store.platform, 'Mod+K')})`}
        aria-label="命令面板"
        aria-keyshortcuts={shortcutAria(store.platform, 'Mod+K')}
        onClick={() => store.openOverlay('command')}
      >
        <Icon name="command" size="large" />
      </button>
      <button
        className="rail-button"
        type="button"
        title={`设置 (${shortcutText(store.platform, 'Mod+,')})`}
        aria-label="设置"
        aria-keyshortcuts={shortcutAria(store.platform, 'Mod+,')}
        onClick={() => store.openOverlay('settings')}
      >
        <Icon name="settings" size="large" />
      </button>
      <div
        className="avatar"
        title={store.gateway.kind === 'tauri' ? '本地工作区' : '浏览器预览'}
        aria-hidden="true"
      >
        YN
      </div>
    </nav>
  )
}
