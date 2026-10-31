import { createTauriGateway } from './tauri.js'
import { createWebGateway } from './web.js'
import type { DocumentGateway } from './types.js'

export function hasTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function createGateway(): DocumentGateway {
  return hasTauri() ? createTauriGateway() : createWebGateway()
}

export type { DocumentGateway, Draft, OpenedDocument, WorkspaceNode } from './types.js'
