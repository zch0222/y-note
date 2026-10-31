import { useMemo, useState } from 'react'

import type { WorkspaceNode } from '../platform/types.js'
import { useAppStore } from '../state/useStore.js'
import { Icon } from './Icon.js'
import { shortcutText } from './shortcuts.js'

function countFiles(node: WorkspaceNode): number {
  if (!node.isDir) {
    return 1
  }
  return node.children.reduce((total, child) => total + countFiles(child), 0)
}

function filterTree(node: WorkspaceNode, query: string): WorkspaceNode | null {
  if (!query) {
    return node
  }
  const needle = query.toLowerCase()
  if (!node.isDir) {
    return node.name.toLowerCase().includes(needle) ? node : null
  }
  if (node.name.toLowerCase().includes(needle)) {
    return node
  }
  const children = node.children
    .map(child => filterTree(child, query))
    .filter((child): child is WorkspaceNode => child !== null)
  return children.length > 0 ? { ...node, children } : null
}

interface TreeRowsProps {
  node: WorkspaceNode
  depth: number
  expanded: Set<string>
  forceExpanded: boolean
  selectedPath?: string
  onToggle: (path: string) => void
  onOpen: (path: string) => void
}

function TreeRows({
  node,
  depth,
  expanded,
  forceExpanded,
  selectedPath,
  onToggle,
  onOpen,
}: TreeRowsProps) {
  if (!node.isDir) {
    const selected = selectedPath === node.path
    return (
      <div
        className={`tree-row${selected ? ' selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 18 }}
        role="button"
        tabIndex={0}
        title={node.path}
        aria-current={selected ? 'page' : undefined}
        onClick={() => onOpen(node.path)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpen(node.path)
          }
        }}
      >
        <Icon name="file" />
        <span className="file-name">{node.name}</span>
        {selected ? <span className="modified" title="当前文档" /> : null}
      </div>
    )
  }

  const isOpen = forceExpanded || expanded.has(node.path)
  return (
    <>
      <div
        className="tree-row"
        style={{ paddingLeft: 8 + depth * 18 }}
        role="button"
        tabIndex={0}
        title={node.path}
        aria-expanded={isOpen}
        onClick={() => onToggle(node.path)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggle(node.path)
          }
        }}
      >
        <Icon name={isOpen ? 'down' : 'chevron'} />
        <Icon name={isOpen ? 'folderOpen' : 'folder'} />
        <span className="file-name">{node.name}</span>
        <span className="count">{countFiles(node)}</span>
      </div>
      {isOpen
        ? node.children.map(child => (
            <TreeRows
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              forceExpanded={forceExpanded}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))
        : null}
    </>
  )
}

export function Sidebar() {
  const store = useAppStore()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const filter = store.sidebarFilter.trim()
  const tree = useMemo(
    () => (store.workspace ? filterTree(store.workspace, filter) : null),
    [store.workspace, filter],
  )
  const recent = useMemo(() => {
    if (!filter) {
      return store.recent
    }
    const needle = filter.toLowerCase()
    return store.recent.filter(
      entry => entry.name.toLowerCase().includes(needle) || entry.path.toLowerCase().includes(needle),
    )
  }, [store.recent, filter])

  const toggleDir = (path: string) => {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  return (
    <aside className="file-sidebar" id="file-sidebar" aria-label="文件栏">
      <div className="sidebar-head">
        <h2 className="sidebar-title">资源管理器</h2>
        <div className="sidebar-head-actions">
          <button
            className="icon-button"
            type="button"
            title="新建文件（后续里程碑）"
            aria-label="新建文件"
            onClick={() => store.notify('新建文件将在后续里程碑提供。')}
          >
            <Icon name="plus" size="small" />
          </button>
          <button
            className="icon-button"
            type="button"
            title="刷新文件夹"
            aria-label="刷新文件夹"
            onClick={() => {
              if (store.workspace) {
                void store.refreshWorkspace()
              } else {
                void store.openWorkspace()
              }
            }}
          >
            <Icon name="refresh" size="small" />
          </button>
        </div>
      </div>

      <label className="search-box">
        <Icon name="search" size="small" />
        <input
          id="file-search"
          type="search"
          aria-label="搜索工作区文件"
          placeholder="搜索文件"
          value={store.sidebarFilter}
          onChange={event => store.setSidebarFilter(event.target.value)}
        />
        <span className="key">{shortcutText(store.platform, 'Mod+P')}</span>
      </label>

      <div className="tree-scroll">
        <h3 className="section-label">
          <Icon name="down" size="small" />
          工作区
        </h3>
        {tree ? (
          <>
            <div className="tree-row" style={{ paddingLeft: 8 }} title={tree.path}>
              <Icon name="folderOpen" />
              <span className="file-name">{tree.name}</span>
              <span className="count">{countFiles(tree)}</span>
            </div>
            {tree.children.map(child => (
              <TreeRows
                key={child.path}
                node={child}
                depth={1}
                expanded={expanded}
                forceExpanded={filter.length > 0}
                selectedPath={store.doc?.path}
                onToggle={toggleDir}
                onOpen={path => void store.openPath(path)}
              />
            ))}
            {tree.children.length === 0 ? (
              <div className="sidebar-empty">此文件夹中没有 Markdown 文件。</div>
            ) : null}
          </>
        ) : (
          <div className="sidebar-empty">
            {store.gateway.kind === 'tauri'
              ? '尚未打开文件夹。打开后可以浏览并打开工作区中的 Markdown 文件。'
              : '浏览器预览不支持文件夹浏览，请使用桌面版。'}
            <button
              className="button"
              type="button"
              style={{ marginTop: 10, width: '100%' }}
              onClick={() => void store.openWorkspace()}
            >
              <Icon name="folderOpen" size="small" />
              打开文件夹
            </button>
          </div>
        )}

        <div className="tree-gap" />
        <h3 className="section-label">
          <Icon name="clock" size="small" />
          最近打开
        </h3>
        {recent.length === 0 ? (
          <div className="sidebar-empty">还没有打开过文件。</div>
        ) : (
          recent.map(entry => {
            const selected = store.doc?.path === entry.path
            return (
              <div
                key={entry.path}
                className={`tree-row${selected ? ' selected' : ''}`}
                role="button"
                tabIndex={0}
                title={entry.path}
                aria-current={selected ? 'page' : undefined}
                onClick={() => void store.openPath(entry.path)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    void store.openPath(entry.path)
                  }
                }}
              >
                <Icon name="clock" />
                <span className="file-name">{entry.name}</span>
                {selected && store.doc?.dirty ? (
                  <span className="modified" title="未保存" />
                ) : null}
              </div>
            )
          })
        )}
        {store.workspaceError ? <div className="sidebar-empty">{store.workspaceError}</div> : null}
      </div>

      <div className="sidebar-footer">
        <div className="workspace-card">
          <div className="workspace-icon">
            <Icon name={store.workspace ? 'folderOpen' : 'folder'} />
          </div>
          <div className="workspace-meta">
            <strong>{store.workspace?.name ?? '本地工作区'}</strong>
            <span title={store.workspace?.path}>
              {store.workspace?.path ?? (store.gateway.kind === 'tauri' ? '未选择文件夹' : '浏览器内存预览')}
            </span>
          </div>
          <button
            className="icon-button"
            type="button"
            title="打开文件夹"
            aria-label="打开文件夹"
            onClick={() => void store.openWorkspace()}
          >
            <Icon name="plus" size="small" />
          </button>
        </div>
      </div>
    </aside>
  )
}
