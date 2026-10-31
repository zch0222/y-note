import { useAppStore } from '../state/useStore.js'
import { Icon } from './Icon.js'
import { Modal } from './Modal.js'
import { shortcutText } from './shortcuts.js'

const APP_SHORTCUTS = [
  ['Mod+K', '打开命令面板'],
  ['Mod+O', '打开文件'],
  ['Mod+Shift+O', '打开文件夹'],
  ['Mod+S', '保存文档'],
  ['Mod+P', '搜索工作区文件'],
  ['Mod+Shift+E', '切换源码 / 所见即所得'],
  ['Mod+Shift+P', '打印 / 导出 PDF'],
  ['Mod+Shift+B', '显示或隐藏文件栏'],
  ['Mod+Shift+D', '显示或隐藏上下文面板'],
  ['Mod+,', '打开设置'],
  ['Mod+/', '查看快捷键'],
  ['Esc', '关闭面板或对话框'],
] as const

const EDITOR_SHORTCUTS = [
  ['Mod+B', '粗体'],
  ['Mod+I', '斜体'],
  ['Mod+E', '行内代码'],
  ['Mod+Shift+X', '删除线'],
  ['Mod+Alt+1', '标题 1'],
  ['Mod+Alt+2', '标题 2'],
  ['Mod+Alt+3', '标题 3'],
  ['Mod+Alt+0', '正文'],
  ['Mod+Z', '撤销'],
  ['Mod+Shift+Z', '重做'],
] as const

export function ShortcutsDialog() {
  const store = useAppStore()

  return (
    <Modal
      title="键盘快捷键"
      description="所有核心操作都可以不使用鼠标完成。"
      onClose={() => store.closeOverlay()}
      className="shortcuts-modal"
    >
      <div className="shortcut-columns">
        <section aria-labelledby="shortcuts-app">
          <h3 id="shortcuts-app">应用</h3>
          <dl className="shortcut-list">
            {APP_SHORTCUTS.map(([keys, label]) => (
              <div key={keys}>
                <dt>{label}</dt>
                <dd>
                  <kbd>{shortcutText(store.platform, keys)}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <section aria-labelledby="shortcuts-editor">
          <h3 id="shortcuts-editor">编辑</h3>
          <dl className="shortcut-list">
            {EDITOR_SHORTCUTS.map(([keys, label]) => (
              <div key={keys}>
                <dt>{label}</dt>
                <dd>
                  <kbd>{shortcutText(store.platform, keys)}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
      <div className="settings-actions">
        <button
          className="button primary"
          type="button"
          data-autofocus
          onClick={() => {
            store.closeOverlay()
            window.setTimeout(() => store.openOverlay('command'), 0)
          }}
        >
          <Icon name="command" size="small" />
          打开命令面板
        </button>
      </div>
    </Modal>
  )
}
