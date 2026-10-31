import { useAppStore } from '../state/useStore.js'

export function Toast() {
  const store = useAppStore()

  return (
    <div className={`toast${store.toast ? ' show' : ''}`} role="status" aria-live="polite">
      {store.toast?.message ?? ''}
    </div>
  )
}
