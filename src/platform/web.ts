import { sha256 } from '../source/encoding.js'
import { isExternalUrlAllowed } from './external.js'
import type {
  DocumentGateway,
  Draft,
  GitDiff,
  OpenedDocument,
  WorkspaceNode,
} from './types.js'

const storagePrefix = 'ynote.draft.'

export function createWebGateway(): DocumentGateway {
  const files = new Map<string, Uint8Array>()

  function storeFile(name: string, bytes: Uint8Array): OpenedDocument {
    files.set(name, bytes)
    return { path: name, bytes, sha256: sha256(bytes) }
  }

  return {
    kind: 'web',

    async openFile(): Promise<OpenedDocument | null> {
      const file = await pickFile()
      if (!file) {
        return null
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      return storeFile(file.name, bytes)
    },

    async openWorkspace(): Promise<WorkspaceNode | null> {
      return null
    },

    async readWorkspace(root: string): Promise<WorkspaceNode> {
      return { name: root, path: root, isDir: true, children: [] }
    },

    async readDocument(path: string): Promise<OpenedDocument> {
      const bytes = files.get(path)
      if (!bytes) {
        const error = new Error(`Browser preview has no open document named ${path}`) as Error & {
          code?: string
        }
        error.code = 'not-found'
        throw error
      }
      return { path, bytes, sha256: sha256(bytes) }
    },

    async writeDocument(
      path: string,
      bytes: Uint8Array,
      _expectedSha256: string,
    ): Promise<{ sha256: string }> {
      files.set(path, bytes)
      return { sha256: sha256(bytes) }
    },

    async hashFile(path: string): Promise<string | null> {
      const bytes = files.get(path)
      return bytes ? sha256(bytes) : null
    },

    async readGitDiff(): Promise<GitDiff> {
      return {
        repoRoot: null,
        branch: null,
        head: null,
        status: 'not-repo',
        additions: 0,
        deletions: 0,
        hunks: [],
        binary: false,
        truncated: false,
        message: '浏览器预览不连接 Git 仓库，请在桌面版查看真实差异。',
      }
    },

    async writeDraft(draft: Draft): Promise<void> {
      localStorage.setItem(`${storagePrefix}${draft.path}`, JSON.stringify(draft))
    },

    async readDraft(path: string): Promise<Draft | null> {
      const raw = localStorage.getItem(`${storagePrefix}${path}`)
      if (!raw) {
        return null
      }
      try {
        return JSON.parse(raw) as Draft
      } catch {
        return null
      }
    },

    async deleteDraft(path: string): Promise<void> {
      localStorage.removeItem(`${storagePrefix}${path}`)
    },

    async openExternal(url: string): Promise<void> {
      if (!isExternalUrlAllowed(url)) {
        throw new Error('Scheme is not allowed')
      }
      window.open(url, '_blank', 'noopener,noreferrer')
    },

    async registerDocument(opened: OpenedDocument): Promise<void> {
      files.set(opened.path, opened.bytes)
    },
  }
}

export function openDemoDocument(gateway: DocumentGateway, name: string, source: string): OpenedDocument {
  const bytes = new TextEncoder().encode(source)
  return { path: name, bytes, sha256: sha256(bytes) }
}

function pickFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain'
    input.style.display = 'none'
    const finish = (file: File | null) => {
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => finish(null), { once: true })
    document.body.append(input)
    input.click()
  })
}
