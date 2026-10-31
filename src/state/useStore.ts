import { useSyncExternalStore } from 'react'

import { store } from './instance.js'
import type { AppStore } from './store.js'

/** Re-renders the caller on every store version bump and returns the store. */
export function useAppStore(): AppStore {
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return store
}
