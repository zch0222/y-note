import { flushSync } from 'react-dom'
import { useEffect, useId, useMemo, useState } from 'react'

import { useAppStore } from '../state/useStore.js'
import { buildCommands, type CommandItem } from './commands.js'
import { Icon } from './Icon.js'
import { Modal } from './Modal.js'
import { shortcutText } from './shortcuts.js'

export function CommandPalette() {
  const store = useAppStore()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const commands = useMemo(() => buildCommands(store), [store])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) {
      return commands
    }
    return commands.filter(command =>
      `${command.title} ${command.detail ?? ''} ${command.keywords}`
        .toLowerCase()
        .includes(needle),
    )
  }, [commands, query])
  const selected = Math.min(active, Math.max(visible.length - 1, 0))

  useEffect(() => {
    setActive(0)
  }, [query])

  const run = (command: CommandItem | undefined) => {
    if (!command || command.disabled) {
      return
    }
    flushSync(() => store.closeOverlay())
    void Promise.resolve(command.run(store)).catch(error => {
      store.notify(`命令失败：${(error as Error).message ?? String(error)}`)
    })
  }

  return (
    <Modal
      title="命令面板"
      description="输入命令名称，或用方向键选择后按回车执行。"
      onClose={() => store.closeOverlay()}
      className="palette-modal"
    >
      <div className="palette-search">
        <Icon name="search" size="small" />
        <input
          data-autofocus
          type="text"
          role="combobox"
          aria-label="搜索命令"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={
            visible.length > 0 ? `${listId}-option-${visible[selected]?.id}` : undefined
          }
          placeholder="搜索命令…"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive(current => (visible.length === 0 ? 0 : (current + 1) % visible.length))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive(current =>
                visible.length === 0 ? 0 : (current - 1 + visible.length) % visible.length,
              )
            } else if (event.key === 'Home') {
              event.preventDefault()
              setActive(0)
            } else if (event.key === 'End') {
              event.preventDefault()
              setActive(Math.max(visible.length - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              run(visible[selected])
            }
          }}
        />
        <kbd>{shortcutText(store.platform, 'Mod+K')}</kbd>
      </div>

      <div className="palette-list" id={listId} role="listbox" aria-label="可用命令">
        {visible.length === 0 ? (
          <p className="palette-empty" role="status">
            没有匹配的命令。
          </p>
        ) : (
          visible.map((command, index) => (
            <div
              key={command.id}
              id={`${listId}-option-${command.id}`}
              className={`palette-item${index === selected ? ' active' : ''}`}
              role="option"
              aria-selected={index === selected}
              aria-disabled={command.disabled || undefined}
              onMouseEnter={() => setActive(index)}
              onMouseDown={event => event.preventDefault()}
              onClick={() => run(command)}
            >
              <span className={`palette-icon${command.disabled ? ' disabled' : ''}`}>
                <Icon name="arrowRight" size="small" />
              </span>
              <span className="palette-text">
                <strong>{command.title}</strong>
                {command.detail ? <small>{command.detail}</small> : null}
              </span>
              {command.shortcut ? (
                <kbd>{shortcutText(store.platform, command.shortcut)}</kbd>
              ) : null}
            </div>
          ))
        )}
      </div>
      <p className="palette-hint">
        <span>↑↓ 选择</span>
        <span>Enter 执行</span>
        <span>Esc 关闭</span>
      </p>
    </Modal>
  )
}
