import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'

import { sha256 } from '../source/encoding.js'
import type {
  DocumentGateway,
  Draft,
  GitDiff,
  GitVersions,
  OpenedDocument,
  WorkspaceNode,
} from './types.js'

interface DocumentResponse {
  path: string
  bytesBase64: string
  sha256: string
}

interface GitVersionsResponse {
  headBase64: string | null
  worktreeBase64: string | null
  headTooLarge: boolean
  worktreeTooLarge: boolean
  renamedFrom: string | null
}

interface WorkspaceResponse {
  name: string
  path: string
  isDir: boolean
  children: WorkspaceResponse[]
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function toWorkspaceNode(node: WorkspaceResponse): WorkspaceNode {
  return {
    name: node.name,
    path: node.path,
    isDir: node.isDir,
    children: node.children.map(toWorkspaceNode),
  }
}

export function createTauriGateway(): DocumentGateway {
  return {
    kind: 'tauri',

    async openFile(): Promise<OpenedDocument | null> {
      const selection = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: 'Markdown',
            extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'],
          },
        ],
      })
      if (typeof selection !== 'string') {
        return null
      }
      return this.readDocument(selection)
    },

    async openWorkspace(): Promise<WorkspaceNode | null> {
      const selection = await open({ multiple: false, directory: true })
      if (typeof selection !== 'string') {
        return null
      }
      return this.readWorkspace(selection)
    },

    async readWorkspace(root: string): Promise<WorkspaceNode> {
      const result = await invoke<WorkspaceResponse>('list_workspace', { root })
      return toWorkspaceNode(result)
    },

    async readDocument(path: string): Promise<OpenedDocument> {
      const result = await invoke<DocumentResponse>('read_document', { path })
      const bytes = decodeBase64(result.bytesBase64)
      return { path, bytes, sha256: sha256(bytes) }
    },

    async writeDocument(
      path: string,
      bytes: Uint8Array,
      expectedSha256: string,
    ): Promise<{ sha256: string }> {
      const result = await invoke<{ sha256: string }>('write_document_atomic', {
        path,
        bytesBase64: encodeBase64(bytes),
        expectedSha256,
      })
      return { sha256: result.sha256 }
    },

    async hashFile(path: string): Promise<string | null> {
      return invoke<string | null>('hash_file', { path })
    },

    async readGitDiff(path: string): Promise<GitDiff> {
      return invoke<GitDiff>('read_git_diff', { path })
    },

    async readGitVersions(path: string): Promise<GitVersions> {
      const result = await invoke<GitVersionsResponse>('read_git_versions', { path })
      return {
        headBytes: result.headBase64 ? decodeBase64(result.headBase64) : null,
        worktreeBytes: result.worktreeBase64 ? decodeBase64(result.worktreeBase64) : null,
        headTooLarge: result.headTooLarge,
        worktreeTooLarge: result.worktreeTooLarge,
        renamedFrom: result.renamedFrom,
      }
    },

    async writeDraft(draft: Draft): Promise<void> {
      await invoke('write_draft', { draft })
    },

    async readDraft(path: string): Promise<Draft | null> {
      return invoke<Draft | null>('read_draft', { path })
    },

    async deleteDraft(path: string): Promise<void> {
      await invoke('delete_draft', { path })
    },

    async watchDocument(path: string, onChanged: () => void): Promise<() => Promise<void>> {
      const unlisten = await listen<{ path: string }>('ynote://document-changed', event => {
        if (event.payload?.path === path) {
          onChanged()
        }
      })
      try {
        await invoke('watch_document', { path })
      } catch (error) {
        unlisten()
        throw error
      }
      return async () => {
        unlisten()
        await invoke('unwatch_document').catch(() => undefined)
      }
    },
  }
}
