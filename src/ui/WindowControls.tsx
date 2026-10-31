import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'

import { useAppStore } from '../state/useStore.js'
import { Icon } from './Icon.js'

export function WindowControls() {
  const store = useAppStore()
  const visible = store.gateway.kind === 'tauri' && store.platform === 'windows'
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!visible) {
      return
    }
    const appWindow = getCurrentWindow()
    let active = true
    let unlisten: (() => void) | undefined
    const sync = () => {
      void appWindow
        .isMaximized()
        .then(value => {
          if (active) {
            setMaximized(value)
          }
        })
        .catch(() => undefined)
    }
    sync()
    void appWindow
      .onResized(() => {
        sync()
      })
      .then(dispose => {
        if (active) {
          unlisten = dispose
        } else {
          dispose()
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
      unlisten?.()
    }
  }, [visible])

  if (!visible) {
    return null
  }

  const appWindow = getCurrentWindow()
  const run = (action: () => Promise<void>) => {
    void action().catch(error => {
      store.notify(`窗口操作失败：${(error as Error).message ?? String(error)}`)
    })
  }

  return (
    <div className="window-controls" role="group" aria-label="窗口控制">
      <button
        className="window-control"
        type="button"
        title="最小化"
        aria-label="最小化窗口"
        onClick={() => run(() => appWindow.minimize())}
      >
        <Icon name="minus" size="small" />
      </button>
      <button
        className="window-control"
        type="button"
        title={maximized ? '还原' : '最大化'}
        aria-label={maximized ? '还原窗口' : '最大化窗口'}
        onClick={() =>
          run(async () => {
            await appWindow.toggleMaximize()
            const value = await appWindow.isMaximized()
            setMaximized(value)
          })
        }
      >
        <Icon name={maximized ? 'restore' : 'square'} size="small" />
      </button>
      <button
        className="window-control close"
        type="button"
        title="关闭"
        aria-label="关闭窗口"
        onClick={() => run(() => appWindow.close())}
      >
        <Icon name="x" size="small" />
      </button>
    </div>
  )
}
