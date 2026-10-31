import type { DocState } from '../state/store.js'
import { useAppStore } from '../state/useStore.js'
import { Icon } from './Icon.js'

function timeLabel(timestamp: number | null): string {
  if (!timestamp) {
    return '尚未保存'
  }
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function DocumentHeader({ doc }: { doc: DocState }) {
  const store = useAppStore()
  const directory = doc.directory.split(/[\\/]/).filter(Boolean).pop()

  return (
    <div className="document-head">
      <div className="breadcrumb" title={doc.path}>
        {directory ? <span>{directory}</span> : null}
        {directory ? <Icon name="chevron" size="small" style={{ width: 11 }} /> : null}
        <span className="current">{doc.name}</span>
        {doc.dirty ? <span className="dirty-pill">未保存</span> : null}
      </div>
      <div className="document-actions">
        <span className="history-label">
          {doc.dirty ? '改动尚未写回磁盘' : `最后保存 ${timeLabel(doc.lastSavedAt)}`}
        </span>
        <button
          className="icon-button"
          type="button"
          title="重新载入磁盘内容"
          aria-label="重新载入"
          onClick={() => void store.reloadFromDisk()}
        >
          <Icon name="refresh" size="small" />
        </button>
        <button
          className="icon-button"
          type="button"
          title="保存 (Ctrl/Cmd + S)"
          aria-label="保存"
          disabled={Boolean(doc.readOnly)}
          onClick={() => void store.save()}
        >
          <Icon name="save" size="small" />
        </button>
      </div>
    </div>
  )
}
