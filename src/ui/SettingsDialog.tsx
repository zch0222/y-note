import { APP_VERSION } from '../version.js'
import { useAppStore } from '../state/useStore.js'
import { Icon } from './Icon.js'
import { Modal } from './Modal.js'
import { shortcutText } from './shortcuts.js'

const THEME_OPTIONS = [
  { value: 'system', title: '跟随系统', detail: '自动匹配操作系统的浅色或深色外观' },
  { value: 'light', title: '浅色', detail: '纸感工作台与白色文档表面' },
  { value: 'dark', title: '深色', detail: '降低夜间亮度，不使用纯黑' },
] as const

export function SettingsDialog() {
  const store = useAppStore()
  const doc = store.doc

  return (
    <Modal
      title="设置"
      description="偏好设置只保存在本机，不写入文档或 Git 仓库。"
      onClose={() => store.closeOverlay()}
      className="settings-modal"
    >
      <section className="settings-section" aria-labelledby="settings-theme">
        <h3 id="settings-theme">外观</h3>
        <div className="setting-options" role="radiogroup" aria-labelledby="settings-theme">
          {THEME_OPTIONS.map(option => (
            <label
              className={`setting-option${
                store.themePreference === option.value ? ' selected' : ''
              }`}
              key={option.value}
            >
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={store.themePreference === option.value}
                data-autofocus={
                  store.themePreference === option.value ? true : undefined
                }
                onChange={() => store.setThemePreference(option.value)}
              />
              <span>
                <strong>{option.title}</strong>
                <small>{option.detail}</small>
              </span>
            </label>
          ))}
        </div>
        <label className="setting-toggle">
          <input
            type="checkbox"
            checked={store.motionPreference === 'reduced'}
            onChange={event =>
              store.setMotionPreference(event.target.checked ? 'reduced' : 'system')
            }
          />
          <span>
            <strong>减少界面动画</strong>
            <small>关闭面板与提示的过渡动画；系统级“减少动态效果”始终生效。</small>
          </span>
        </label>
      </section>

      <section className="settings-section" aria-labelledby="settings-access">
        <h3 id="settings-access">无障碍</h3>
        <div className="settings-actions">
          <button
            className="button"
            type="button"
            onClick={() => store.openOverlay('shortcuts')}
          >
            <Icon name="command" size="small" />
            查看键盘快捷键
          </button>
          {doc ? (
            <button
              className="button"
              type="button"
              onClick={() => {
                store.closeOverlay()
                window.setTimeout(() => void store.printDocument(), 0)
              }}
            >
              <Icon name="file" size="small" />
              打印 / 导出 PDF
            </button>
          ) : null}
        </div>
        <p className="settings-note">
          界面支持 200% 缩放下操作；正文、辅助文字与控件边界已按 WCAG AA
          对比度检查。打印输出不会回写源文件。
        </p>
      </section>

      <section className="settings-section" aria-labelledby="settings-security">
        <h3 id="settings-security">安全与隐私</h3>
        <dl className="settings-facts">
          <div>
            <dt>版本</dt>
            <dd>{APP_VERSION}</dd>
          </div>
          <div>
            <dt>运行环境</dt>
            <dd>{store.gateway.kind === 'tauri' ? '桌面应用' : '浏览器预览'}</dd>
          </div>
          <div>
            <dt>文件访问</dt>
            <dd>仅限系统对话框授权的文件与文件夹</dd>
          </div>
          <div>
            <dt>外部链接</dt>
            <dd>仅 http / https / mailto，经系统浏览器打开</dd>
          </div>
          <div>
            <dt>草稿</dt>
            <dd>应用数据目录，不进入仓库</dd>
          </div>
          <div>
            <dt>快捷方式</dt>
            <dd>
              命令面板 {shortcutText(store.platform, 'Mod+K')} · 设置{' '}
              {shortcutText(store.platform, 'Mod+,')}
            </dd>
          </div>
        </dl>
      </section>
    </Modal>
  )
}
