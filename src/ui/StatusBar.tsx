import { useAppStore } from '../state/useStore.js'
import { Icon } from './Icon.js'

export function StatusBar() {
  const store = useAppStore()
  const doc = store.doc

  return (
    <footer className="statusbar">
      <div className="status-left">
        <span className="status-item local-status">
          <span className="status-dot" />
          {store.gateway.kind === 'tauri' ? '本地工作区' : '浏览器预览'}
        </span>
        {doc ? (
          <span className="status-item">
            <Icon name="file" size="small" />
            {doc.encoding.toUpperCase()}
          </span>
        ) : null}
        {doc ? <span className="status-item">{doc.eol}</span> : null}
        {doc ? (
          <span className="status-item">
            <Icon name="lock" size="small" />
            草稿不进入仓库
          </span>
        ) : null}
      </div>
      <div className="status-center">
        {doc ? (
          <>
            <span className="status-item">{doc.chars} 字符</span>
            <span className="status-item">{doc.words} 词</span>
            <span className="status-item">
              {doc.readOnly ? '只读' : store.mode === 'source' ? '源码模式' : '所见即所得'}
            </span>
          </>
        ) : (
          <span className="status-item">Ctrl/Cmd + O 打开文件 · Ctrl/Cmd + S 保存</span>
        )}
      </div>
      <div className="status-right">
        {doc ? (
          <span className="status-item">
            <span className={`status-dot ${doc.saveState}`} />
            {doc.dirty ? '有未保存修改' : '已保存'}
          </span>
        ) : null}
      </div>
    </footer>
  )
}
