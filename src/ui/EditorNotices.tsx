import type { ReactNode } from 'react'

import type { DocState } from '../state/store.js'
import { useAppStore } from '../state/useStore.js'
import { Icon } from './Icon.js'

const READ_ONLY_LABEL: Record<string, string> = {
  'unsupported-encoding': '文件编码无法识别，已按只读方式打开。',
  'lossy-decode': '文件无法按字节级无损解码，已按只读方式打开。',
  'unrepresentable-content': '文件包含无法表示的内容，已按只读方式打开。',
}

function draftTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function EditorNotices({ doc }: { doc: DocState }) {
  const store = useAppStore()
  const notices: ReactNode[] = []

  if (doc.draft) {
    notices.push(
      <div className="notice notice-draft" key="draft">
        <div className="notice-icon">
          <Icon name="clock" />
        </div>
        <div className="notice-body">
          <strong>检测到未保存草稿</strong>
          <span>
            {draftTime(doc.draft.updatedAt)} · {doc.draft.source.length} 字符。恢复后可继续编辑，保存前不会写回原文件。
          </span>
        </div>
        <div className="notice-actions">
          <button className="button" type="button" onClick={() => void store.discardDraft()}>
            丢弃
          </button>
          <button className="button primary" type="button" onClick={() => void store.applyDraft()}>
            恢复草稿
          </button>
        </div>
      </div>,
    )
  }

  if (doc.readOnly) {
    notices.push(
      <div className="notice notice-readonly" key="readonly">
        <div className="notice-icon">
          <Icon name="lock" />
        </div>
        <div className="notice-body">
          <strong>只读文档</strong>
          <span>{READ_ONLY_LABEL[doc.readOnly] ?? '该文件已按只读方式打开。'} 源码视图仍可查看原文。</span>
        </div>
      </div>,
    )
  }

  if (doc.external === 'external-change') {
    notices.push(
      <div className="notice notice-warn" key="external">
        <div className="notice-icon">
          <Icon name="warning" />
        </div>
        <div className="notice-body">
          <strong>磁盘文件已在外部修改</strong>
          <span>当前缓冲区没有本地修改。重新载入以查看磁盘上的最新内容。</span>
        </div>
        <div className="notice-actions">
          <button className="button" type="button" onClick={() => void store.reloadFromDisk()}>
            重新载入
          </button>
        </div>
      </div>,
    )
  }

  if (doc.external === 'conflict' && !doc.readOnly) {
    notices.push(
      <div className="notice notice-danger" key="conflict">
        <div className="notice-icon">
          <Icon name="shield" />
        </div>
        <div className="notice-body">
          <strong>保存冲突：磁盘内容与基线不一致</strong>
          <span>
            {doc.dirty
              ? '本地还有未保存修改。保存会被拒绝，不会静默覆盖磁盘文件；草稿会保留以便恢复。'
              : '磁盘文件已变化或被移除。'}
          </span>
        </div>
        <div className="notice-actions">
          <button className="button" type="button" onClick={() => void store.reloadFromDisk()}>
            重新载入
          </button>
          <button className="button primary" type="button" onClick={() => void store.save()}>
            再次尝试保存
          </button>
        </div>
      </div>,
    )
  }

  if (notices.length === 0) {
    return null
  }

  return <div className="notice-stack">{notices}</div>
}
