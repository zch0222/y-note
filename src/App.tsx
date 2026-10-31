import { useEffect } from 'react'

import { useAppStore } from './state/useStore.js'
import { ActivityRail } from './ui/ActivityRail.js'
import { EditorPane } from './ui/EditorPane.js'
import { Inspector } from './ui/Inspector.js'
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
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        void store.save()
      } else if (key === 'o') {
        event.preventDefault()
        void store.openFile()
      } else if (key === 'p') {
        event.preventDefault()
        document.getElementById('file-search')?.focus()
      } else if (key === 'e' && event.shiftKey) {
        event.preventDefault()
        store.setMode(store.mode === 'visual' ? 'source' : 'visual')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
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
    <div className={`window${store.panelOpen ? '' : ' panel-closed'}`}>
      <TitleBar />
      <div className={`workspace${store.panelOpen ? '' : ' panel-closed'}`}>
        <ActivityRail />
        <Sidebar />
        <EditorPane />
        {store.panelOpen ? <Inspector /> : null}
      </div>
      <StatusBar />
      <Toast />
    </div>
  )
}
