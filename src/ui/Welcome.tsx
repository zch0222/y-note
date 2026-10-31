import { DEMO_SOURCE } from '../demo.js'
import { useAppStore } from '../state/useStore.js'
import { Icon } from './Icon.js'
import { shortcutText } from './shortcuts.js'

export function Welcome() {
  const store = useAppStore()
  const recent = store.recent.slice(0, 4)

  return (
    <section className="welcome">
      <div className="welcome-card">
        <div className="welcome-brand">Y</div>
        <p className="welcome-eyebrow">LOCAL FIRST · CLEAN BY DESIGN</p>
        <h1>
          让每一次修改，
          <br />
          都只留下真实的差异。
        </h1>
        <p className="welcome-sub">
          Y Note 是一个本地优先的 Markdown 编辑器。所见即所得负责写作体验，原始源码负责文件真相：
          未触碰的内容不会经过重新序列化。
        </p>
        <div className="welcome-actions">
          <button className="button primary" type="button" onClick={() => void store.openFile()}>
            <Icon name="file" size="small" />
            打开 Markdown
          </button>
          {store.gateway.kind === 'tauri' ? (
            <button className="button" type="button" onClick={() => void store.openWorkspace()}>
              <Icon name="folderOpen" size="small" />
              打开文件夹
            </button>
          ) : null}
          {store.gateway.kind === 'web' ? (
            <button
              className="button"
              type="button"
              onClick={() => void store.openDemo(DEMO_SOURCE)}
            >
              <Icon name="pencil" size="small" />
              打开示例文档
            </button>
          ) : null}
        </div>
        <ul className="welcome-points">
          <li>
            <Icon name="shield" size="small" />
            原始编码、BOM、换行与未编辑块保持原样
          </li>
          <li>
            <Icon name="checkCircle" size="small" />
            只有磁盘基线仍一致时才会写入，冲突不会被静默覆盖
          </li>
          <li>
            <Icon name="lock" size="small" />
            草稿存放在应用数据目录，不写入当前仓库
          </li>
        </ul>
        {recent.length > 0 ? (
          <div className="welcome-recent">
            <div className="section-label">
              <Icon name="clock" size="small" />
              最近打开
            </div>
            {recent.map(entry => (
              <button
                key={entry.path}
                className="welcome-recent-row"
                type="button"
                title={entry.path}
                onClick={() => void store.openPath(entry.path)}
              >
                <Icon name="file" size="small" />
                <span>{entry.name}</span>
                <span className="welcome-recent-path">{entry.path}</span>
                <Icon name="chevron" size="small" />
              </button>
            ))}
          </div>
        ) : null}
        <p className="welcome-note">
          {store.gateway.kind === 'tauri'
            ? `所有内容仅保存在本机。按 ${shortcutText(store.platform, 'Mod+O')} 打开文件，${shortcutText(
                store.platform,
                'Mod+K',
              )} 打开命令面板。`
            : '当前是浏览器预览：文件保存在内存中，不会写回本地磁盘。桌面版提供原子写入与磁盘冲突保护。'}
        </p>
      </div>
    </section>
  )
}
