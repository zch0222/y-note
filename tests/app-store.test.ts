// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  DocumentGateway,
  Draft,
  OpenedDocument,
  WorkspaceNode,
} from '../src/platform/types.js'
import { sha256 } from '../src/source/encoding.js'
import { AppStore } from '../src/state/store.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const PATH = 'C:/notes/note.md'

function encode(source: string): Uint8Array {
  return encoder.encode(source)
}

function decode(bytes: Uint8Array | undefined): string {
  return bytes ? decoder.decode(bytes) : ''
}

function draftFor(source: string, baseline: string): Draft {
  return {
    path: PATH,
    source,
    baselineSha256: sha256(encode(baseline)),
    updatedAt: new Date().toISOString(),
  }
}

class MemoryGateway implements DocumentGateway {
  readonly kind = 'tauri' as const
  files = new Map<string, Uint8Array>()
  drafts = new Map<string, Draft>()
  watchStarts = 0
  private watchHandler: (() => void) | null = null

  constructor(initial: Record<string, string> = {}) {
    for (const [path, source] of Object.entries(initial)) {
      this.files.set(path, encode(source))
    }
  }

  async openFile(): Promise<OpenedDocument | null> {
    return null
  }

  async openWorkspace(): Promise<WorkspaceNode | null> {
    return null
  }

  async readWorkspace(root: string): Promise<WorkspaceNode> {
    return { name: root, path: root, isDir: true, children: [] }
  }

  async readDocument(path: string): Promise<OpenedDocument> {
    const bytes = this.files.get(path)
    if (!bytes) {
      throw Object.assign(new Error(`missing ${path}`), { code: 'not-found' })
    }
    return { path, bytes, sha256: sha256(bytes) }
  }

  async writeDocument(
    path: string,
    bytes: Uint8Array,
    expectedSha256: string,
  ): Promise<{ sha256: string }> {
    const existing = this.files.get(path)
    const actual = existing ? sha256(existing) : ''
    if (actual !== expectedSha256) {
      throw Object.assign(new Error('disk-conflict'), { code: 'disk-conflict' })
    }
    this.files.set(path, bytes)
    return { sha256: sha256(bytes) }
  }

  async hashFile(path: string): Promise<string | null> {
    const bytes = this.files.get(path)
    return bytes ? sha256(bytes) : null
  }

  async writeDraft(draft: Draft): Promise<void> {
    this.drafts.set(draft.path, draft)
  }

  async readDraft(path: string): Promise<Draft | null> {
    return this.drafts.get(path) ?? null
  }

  async deleteDraft(path: string): Promise<void> {
    this.drafts.delete(path)
  }

  async watchDocument(_path: string, onChanged: () => void): Promise<() => void> {
    this.watchStarts += 1
    this.watchHandler = onChanged
    return () => {
      this.watchHandler = null
    }
  }

  externalWrite(source: string): void {
    this.files.set(PATH, encode(source))
  }

  triggerWatch(): void {
    this.watchHandler?.()
  }
}

async function open(gateway: MemoryGateway): Promise<AppStore> {
  const store = new AppStore(gateway)
  await store.openOpened(await gateway.readDocument(PATH))
  return store
}

async function advanceWatch(): Promise<void> {
  await vi.advanceTimersByTimeAsync(200)
  await Promise.resolve()
}

describe('AppStore document workflow', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('opens, edits, saves, and clears the draft', async () => {
    const gateway = new MemoryGateway({ [PATH]: '# Note\n\nhello\n' })
    const store = await open(gateway)

    expect(gateway.watchStarts).toBe(1)
    store.applySourceText('# Note\n\nhello world\n')
    expect(store.doc?.dirty).toBe(true)

    await store.save()

    expect(store.doc?.dirty).toBe(false)
    expect(store.doc?.saveState).toBe('saved')
    expect(store.doc?.external).toBe('none')
    expect(decode(gateway.files.get(PATH))).toBe('# Note\n\nhello world\n')
    expect(gateway.drafts.size).toBe(0)
  })

  it('reports an external change while the buffer is clean', async () => {
    const gateway = new MemoryGateway({ [PATH]: '# Note\n\nhello\n' })
    const store = await open(gateway)

    gateway.externalWrite('# Note\n\nexternal\n')
    gateway.triggerWatch()
    await advanceWatch()

    expect(store.doc?.external).toBe('external-change')
    expect(store.doc?.dirty).toBe(false)
  })

  it('turns a watcher event into a conflict when the buffer is dirty', async () => {
    const gateway = new MemoryGateway({ [PATH]: '# Note\n\nhello\n' })
    const store = await open(gateway)

    store.applySourceText('# Note\n\nlocal\n')
    gateway.externalWrite('# Note\n\nexternal\n')
    gateway.triggerWatch()
    await advanceWatch()

    expect(store.doc?.external).toBe('conflict')
    await store.save()
    expect(store.doc?.external).toBe('conflict')
    expect(decode(gateway.files.get(PATH))).toBe('# Note\n\nexternal\n')
  })

  it('keeps local content only after explicit confirmation', async () => {
    const gateway = new MemoryGateway({ [PATH]: '# Note\n\nhello\n' })
    const store = await open(gateway)
    store.applySourceText('# Note\n\nlocal\n')
    gateway.externalWrite('# Note\n\nexternal\n')
    gateway.triggerWatch()
    await advanceWatch()
    expect(store.doc?.external).toBe('conflict')

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await store.keepLocalConflict()
    expect(confirm).toHaveBeenCalled()
    expect(decode(gateway.files.get(PATH))).toBe('# Note\n\nexternal\n')
    expect(store.doc?.external).toBe('conflict')

    confirm.mockReturnValue(true)
    await store.keepLocalConflict()
    expect(decode(gateway.files.get(PATH))).toBe('# Note\n\nlocal\n')
    expect(store.doc?.external).toBe('none')
    expect(store.doc?.dirty).toBe(false)
  })

  it('recreates a deleted file when the user keeps local content', async () => {
    const gateway = new MemoryGateway({ [PATH]: '# Note\n\nhello\n' })
    const store = await open(gateway)
    store.applySourceText('# Note\n\nlocal\n')
    gateway.files.delete(PATH)
    gateway.triggerWatch()
    await advanceWatch()
    expect(store.doc?.external).toBe('conflict')

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await store.keepLocalConflict()

    expect(decode(gateway.files.get(PATH))).toBe('# Note\n\nlocal\n')
    expect(store.doc?.external).toBe('none')
    expect(store.doc?.dirty).toBe(false)
  })

  it('keeps document epochs strictly increasing across mode switches and reloads', async () => {
    const gateway = new MemoryGateway({ [PATH]: '# Note\n\nhello\n' })
    const store = await open(gateway)
    const opened = store.doc!.epoch

    store.setMode('source')
    store.setMode('visual')
    const projected = store.doc!.epoch
    expect(projected).toBeGreaterThan(opened)

    await store.reloadFromDisk()
    expect(store.doc!.epoch).toBeGreaterThan(projected)
  })

  it('restores a draft without touching the disk until an explicit save', async () => {
    const original = '# Note\n\nhello\n'
    const gateway = new MemoryGateway({ [PATH]: original })
    gateway.drafts.set(PATH, draftFor('# Note\n\nhello draft\n', original))
    const store = await open(gateway)

    expect(store.doc?.draft).not.toBeNull()
    expect(store.doc?.dirty).toBe(false)
    expect(decode(gateway.files.get(PATH))).toBe(original)

    await store.applyDraft()

    expect(store.doc?.dirty).toBe(true)
    expect(decode(gateway.files.get(PATH))).toBe(original)

    await store.save()
    expect(decode(gateway.files.get(PATH))).toBe('# Note\n\nhello draft\n')
    expect(gateway.drafts.size).toBe(0)
  })
})
