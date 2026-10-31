import { useEffect } from 'react'

import { useAppStore } from './state/useStore.js'
import { ActivityRail } from './ui/ActivityRail.js'
import { CommandPalette } from './ui/CommandPalette.js'
import { ConfirmDialog } from './ui/ConfirmDialog.js'
import { EditorPane } from './ui/EditorPane.js'
import { Inspector } from './ui/Inspector.js'
import { PrintPreview } from './ui/PrintPreview.js'
import { SettingsDialog } from './ui/SettingsDialog.js'
import { ShortcutsDialog } from './ui/ShortcutsDialog.js'
import { Sidebar } from './ui/Sidebar.js'
import { StatusBar } from './ui/StatusBar.js'
import { TitleBar } from './ui/TitleBar.js'
import { Toast } from './ui/Toast.js'

export function App() {
  const store = useAppStore()

  useEffect(() => {
    void store.init()
  }, [store])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return
      }
      if (event.defaultPrevented || store.confirmRequest) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 's' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        void store.save()
      } else if (key === 'o' && !event.altKey) {
        event.preventDefault()
        if (event.shiftKey) {
          void store.openWorkspace()
        } else {
          void store.openFile()
        }
      } else if (key === 'p' && !event.altKey) {
        event.preventDefault()
        if (event.shiftKey) {
          void store.printDocument()
        } else {
          document.getElementById('file-search')?.focus()
        }
      } else if (key === 'e' && event.shiftKey) {
        event.preventDefault()
        store.setMode(store.mode === 'visual' ? 'source' : 'visual')
      } else if (key === 'k' && !event.shiftKey) {
        event.preventDefault()
        // Tiptap binds Mod-k to the link mark; the command palette takes priority.
        event.stopPropagation()
        store.openOverlay('command')
      } else if (key === ',' && !event.shiftKey) {
        event.preventDefault()
        store.openOverlay('settings')
      } else if (key === '/' && !event.shiftKey) {
        event.preventDefault()
        store.openOverlay('shortcuts')
      } else if (key === 'b' && event.shiftKey) {
        event.preventDefault()
        store.toggleSidebar()
      } else if (key === 'd' && event.shiftKey) {
        event.preventDefault()
        store.togglePanel()
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [store])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sourceId?: unknown; checked?: unknown }>).detail
      if (typeof detail?.sourceId === 'string' && typeof detail.checked === 'boolean') {
        void store.toggleTask(detail.sourceId, detail.checked)
      }
    }
    window.addEventListener('ynote:toggle-task', handler)
    return () => window.removeEventListener('ynote:toggle-task', handler)
  }, [store])

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (store.doc?.dirty) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [store])

  return (
    <div
      className={`window${store.panelOpen ? '' : ' panel-closed'}${
        store.sidebarOpen ? '' : ' sidebar-closed'
      }`}
    >
      <a
        className="skip-link"
        href="#editor-pane"
        onClick={event => {
          event.preventDefault()
          if (store.doc) {
            store.focusEditor()
          } else {
            document.getElementById('editor-pane')?.focus()
          }
        }}
      >
        跳到正文
      </a>
      <TitleBar />
      <div
        className={`workspace${store.panelOpen ? '' : ' panel-closed'}${
          store.sidebarOpen ? '' : ' sidebar-closed'
        }`}
      >
        <ActivityRail />
        <Sidebar />
        <EditorPane />
        {store.panelOpen ? <Inspector /> : null}
      </div>
      <StatusBar />
      <Toast />
      <PrintPreview />
      {store.overlay === 'command' ? <CommandPalette /> : null}
      {store.overlay === 'settings' ? <SettingsDialog /> : null}
      {store.overlay === 'shortcuts' ? <ShortcutsDialog /> : null}
      <ConfirmDialog />
    </div>
  )
}
