import { useAppStore } from '../state/useStore.js'
import { Icon } from './Icon.js'

export function ActivityRail() {
  const store = useAppStore()

  return (
    <nav className="activity-rail" aria-label="活动栏">
      <div className="brand" title="Y Note">
        Y
      </div>
      <button className="rail-button active" type="button" title="文件" aria-label="文件">
        <Icon name="files" size="large" />
      </button>
      <button
        className="rail-button"
        type="button"
        title="搜索文件 (Ctrl/Cmd + P)"
        aria-label="搜索文件"
        onClick={() => document.getElementById('file-search')?.focus()}
      >
        <Icon name="search" size="large" />
      </button>
      <button
        className={`rail-button${store.inspectorTab === 'diff' && store.panelOpen ? ' active' : ''}`}
        type="button"
        title="源码改动"
        aria-label="源码改动"
        onClick={() => store.setInspectorTab('diff')}
      >
        <Icon name="git" size="large" />
      </button>
      <div className="rail-spacer" />
      <button
        className="rail-button"
        type="button"
        title="快捷键"
        aria-label="快捷键"
        onClick={() => store.notify('Ctrl/Cmd+S 保存 · Ctrl/Cmd+O 打开 · Ctrl/Cmd+Shift+E 切换源码')}
      >
        <Icon name="command" size="large" />
      </button>
      <button
        className="rail-button"
        type="button"
        title="设置"
        aria-label="设置"
        onClick={() => store.notify('设置将在后续里程碑提供。')}
      >
        <Icon name="settings" size="large" />
      </button>
      <div className="avatar" title={store.gateway.kind === 'tauri' ? '本地工作区' : '浏览器预览'}>
        YN
      </div>
    </nav>
  )
}
