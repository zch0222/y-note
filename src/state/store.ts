import type { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'

import { EditorBridge, type SelectionHint } from '../editor/bridge.js'
import { collectOutline, countWords, toTiptapDocument } from '../editor/project.js'
import type { OutlineItem } from '../editor/project.js'
import { openEnvelope } from '../source/Envelope.js'
import { sha256 } from '../source/encoding.js'
import { setTaskChecked } from '../source/patch.js'
import { projectDocument } from '../source/projection.js'
import { SourceBuffer } from '../source/SourceBuffer.js'
import { saveDocument } from '../source/save.js'
import type { SaveIO } from '../source/save.js'
import type { EolStyle, ReadOnlyReason, SourceEncoding, SourceEdit } from '../source/types.js'
import type { DocumentGateway, Draft, OpenedDocument, WorkspaceNode } from '../platform/types.js'

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'
export type ExternalState = 'none' | 'external-change' | 'conflict'
export type EditorMode = 'visual' | 'source'
export type Theme = 'light' | 'dark'
export type InspectorTab = 'outline' | 'diff'

export interface RecentFile {
  path: string
  name: string
  openedAt: number
}

export interface DocState {
  path: string
  name: string
  directory: string
  buffer: SourceBuffer
  tiptap: JSONContent
  outline: OutlineItem[]
  dirty: boolean
  saveState: SaveState
  readOnly?: ReadOnlyReason
  encoding: SourceEncoding
  eol: EolStyle
  lastSavedAt: number | null
  loadId: number
  epoch: number
  hint?: SelectionHint
  external: ExternalState
  draft: Draft | null
  chars: number
  words: number
}

interface Toast {
  id: number
  message: string
}

const RECENT_KEY = 'ynote.recent'
const THEME_KEY = 'ynote.theme'
const WORKSPACE_KEY = 'ynote.workspace'
const PANEL_KEY = 'ynote.panel'

function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index === -1 ? '' : normalized.slice(0, index)
}

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export class AppStore {
  private listeners = new Set<() => void>()
  private version = 0
  private disposed = false

  readonly gateway: DocumentGateway
  doc: DocState | null = null
  editor: Editor | null = null
  bridge: EditorBridge | null = null
  workspace: WorkspaceNode | null = null
  workspaceError: string | null = null
  recent: RecentFile[] = []
  theme: Theme = 'light'
  mode: EditorMode = 'visual'
  inspectorTab: InspectorTab = 'outline'
  panelOpen = true
  sidebarFilter = ''
  toast: Toast | null = null
  initialized = false
  private epochCounter = 0
  private loadCounter = 0
  private draftTimer: ReturnType<typeof setTimeout> | null = null
  private metaTimer: ReturnType<typeof setTimeout> | null = null
  private toastTimer: ReturnType<typeof setTimeout> | null = null
  private watchDispose: (() => void | Promise<void>) | null = null
  private watchTimer: ReturnType<typeof setTimeout> | null = null
  private watchBusy = false

  constructor(gateway: DocumentGateway) {
    this.gateway = gateway
    this.recent = safeRead<RecentFile[]>(RECENT_KEY, [])
    const storedTheme = localStorage.getItem(THEME_KEY)
    this.theme = storedTheme === 'dark' ? 'dark' : 'light'
    const storedPanel = localStorage.getItem(PANEL_KEY)
    this.panelOpen = storedPanel !== 'closed'
    document.documentElement.dataset.theme = this.theme
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): number => this.version

  emit(): void {
    if (this.disposed) {
      return
    }
    this.version += 1
    for (const listener of this.listeners) {
      listener()
    }
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return
    }
    this.initialized = true

    if (this.gateway.kind === 'tauri') {
      const stored = localStorage.getItem(WORKSPACE_KEY)
      if (stored) {
        try {
          this.workspace = await this.gateway.readWorkspace(stored)
        } catch {
          localStorage.removeItem(WORKSPACE_KEY)
        }
      }
    }
    this.emit()
  }

  attachEditor(editor: Editor): void {
    this.editor = editor
    this.bindBridge()
    this.emit()
  }

  detachEditor(editor: Editor): void {
    if (this.editor !== editor) {
      return
    }
    this.bridge?.destroy()
    this.bridge = null
    this.editor = null
    this.emit()
  }

  bindBridge(): void {
    this.bridge?.destroy()
    this.bridge = null
    if (!this.editor || !this.doc) {
      return
    }
    this.bridge = new EditorBridge(this.editor, this.doc.buffer, {
      onSourceApplied: () => this.afterSourceApplied(),
      onProjected: (json, hint) => this.applyProjection(json, hint),
      onNotice: message => this.notify(message),
    })
  }

  async openFile(): Promise<void> {
    try {
      const opened = await this.gateway.openFile()
      if (opened) {
        await this.openOpened(opened)
      }
    } catch (error) {
      this.notify(`打开失败：${(error as Error).message ?? String(error)}`)
    }
  }

  async openPath(path: string): Promise<void> {
    try {
      const opened = await this.gateway.readDocument(path)
      await this.openOpened(opened)
    } catch (error) {
      this.notify(`打开失败：${(error as Error).message ?? String(error)}`)
      this.recent = this.recent.filter(entry => entry.path !== path)
      this.persistRecent()
      this.emit()
    }
  }

  async openDemo(source: string, name = 'y-note-demo.md'): Promise<void> {
    if (!this.gateway.registerDocument) {
      this.notify('示例文档仅在浏览器预览中可用，请打开真实 Markdown 文件。')
      return
    }
    const bytes = new TextEncoder().encode(source)
    const opened = { path: name, bytes, sha256: sha256(bytes) }
    await this.gateway.registerDocument(opened)
    await this.openOpened(opened)
  }

  async openOpened(opened: OpenedDocument): Promise<void> {
    if (this.doc?.dirty) {
      await this.flushDraft()
      const proceed = window.confirm(
        '当前文档有未保存的修改。继续打开其他文件？草稿已保留，可在重新打开时恢复。',
      )
      if (!proceed) {
        return
      }
    }

    const envelope = openEnvelope(opened.path, opened.bytes)
    const buffer = new SourceBuffer(envelope)
    const projected = projectDocument(buffer.map)
    const tiptap = toTiptapDocument(projected)
    const draft = await this.gateway.readDraft(opened.path).catch(() => null)
    const hasDraft = Boolean(draft && draft.source !== buffer.current)

    this.doc = {
      path: opened.path,
      name: basename(opened.path),
      directory: dirname(opened.path),
      buffer,
      tiptap,
      outline: collectOutline(tiptap),
      dirty: false,
      saveState: 'saved',
      ...(envelope.readOnlyReason ? { readOnly: envelope.readOnlyReason } : {}),
      encoding: envelope.encoding,
      eol: envelope.eol,
      lastSavedAt: Date.now(),
      loadId: ++this.loadCounter,
      epoch: this.nextEpoch(),
      external: 'none',
      draft: hasDraft ? draft : null,
      chars: buffer.current.length,
      words: countWords(buffer.current),
    }
    this.mode = envelope.readOnlyReason ? 'source' : 'visual'
    this.inspectorTab = 'outline'
    this.addRecent(opened.path)
    this.bindBridge()
    await this.startWatching()
    this.updateTitle()
    this.emit()
  }

  async openWorkspace(): Promise<void> {
    try {
      const node = await this.gateway.openWorkspace()
      if (!node) {
        if (this.gateway.kind === 'web') {
          this.notify('浏览器预览不支持打开文件夹，请在桌面版使用。')
        }
        return
      }
      this.workspace = node
      localStorage.setItem(WORKSPACE_KEY, node.path)
      this.workspaceError = null
      this.emit()
    } catch (error) {
      this.notify(`打开文件夹失败：${(error as Error).message ?? String(error)}`)
    }
  }

  async refreshWorkspace(): Promise<void> {
    if (!this.workspace) {
      return
    }
    try {
      this.workspace = await this.gateway.readWorkspace(this.workspace.path)
      this.emit()
    } catch (error) {
      this.workspaceError = (error as Error).message ?? String(error)
      this.notify('刷新文件夹失败。')
      this.emit()
    }
  }

  setTheme(theme: Theme): void {
    this.theme = theme
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
    this.emit()
  }

  toggleTheme(): void {
    this.setTheme(this.theme === 'light' ? 'dark' : 'light')
  }

  setMode(mode: EditorMode): void {
    if (this.doc?.readOnly && mode === 'visual') {
      return
    }
    if (mode === 'visual' && this.doc) {
      const projected = toTiptapDocument(projectDocument(this.doc.buffer.map))
      this.doc.tiptap = projected
      this.doc.outline = collectOutline(projected)
      this.doc.epoch = this.nextEpoch()
      this.doc.hint = undefined
    }
    this.mode = mode
    this.emit()
  }

  applySourceText(text: string): void {
    const doc = this.doc
    if (!doc || doc.readOnly || text === doc.buffer.current) {
      return
    }
    const result = doc.buffer.applyEdits([{ from: 0, to: doc.buffer.current.length, insert: text }], 'S4')
    if (!result.applied) {
      return
    }
    this.afterSourceApplied()
    this.emit()
  }

  setInspectorTab(tab: InspectorTab): void {
    this.inspectorTab = tab
    if (!this.panelOpen) {
      this.panelOpen = true
      localStorage.setItem(PANEL_KEY, 'open')
    }
    this.emit()
  }

  togglePanel(): void {
    this.panelOpen = !this.panelOpen
    localStorage.setItem(PANEL_KEY, this.panelOpen ? 'open' : 'closed')
    this.emit()
  }

  setSidebarFilter(value: string): void {
    this.sidebarFilter = value
    this.emit()
  }

  notify(message: string): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer)
    }
    this.toast = { id: Date.now(), message }
    this.emit()
    this.toastTimer = setTimeout(() => {
      this.toast = null
      this.emit()
    }, 2800)
  }

  private nextEpoch(): number {
    this.epochCounter = Math.max(this.epochCounter, this.doc?.epoch ?? 0) + 1
    return this.epochCounter
  }

  private syncSourceMeta(): boolean {
    if (!this.doc) {
      return false
    }
    const wasDirty = this.doc.dirty
    this.doc.dirty = this.doc.buffer.dirty
    this.doc.saveState = this.doc.dirty ? 'dirty' : 'saved'
    this.doc.chars = this.doc.buffer.current.length
    this.doc.words = countWords(this.doc.buffer.current)
    this.scheduleDraft()
    this.updateTitle()
    return !wasDirty && this.doc.dirty
  }

  afterSourceApplied(): void {
    if (!this.doc) {
      return
    }
    if (this.syncSourceMeta()) {
      this.emit()
    } else {
      this.scheduleMeta()
    }
  }

  applyProjection(json: JSONContent, hint?: SelectionHint): void {
    if (!this.doc) {
      return
    }
    this.syncSourceMeta()
    this.doc.tiptap = json
    this.doc.epoch = this.nextEpoch()
    this.doc.hint = hint
    this.doc.outline = collectOutline(json)
    this.emit()
  }

  async save(): Promise<void> {
    const doc = this.doc
    if (!doc) {
      return
    }
    if (doc.readOnly) {
      this.notify('该文件以只读方式打开，无法保存。')
      return
    }

    doc.saveState = 'saving'
    this.emit()

    const io: SaveIO = {
      read: async path => {
        try {
          const opened = await this.gateway.readDocument(path)
          return opened.bytes
        } catch (error) {
          const code = (error as { code?: string }).code
          if (code === 'not-found') {
            return null
          }
          throw error
        }
      },
      write: async (path, bytes, options) => {
        await this.gateway.writeDocument(path, bytes, options?.expectedSha256 ?? '')
      },
    }

    try {
      const result = await saveDocument(doc.buffer, io)
      if (result.saved) {
        doc.dirty = false
        doc.saveState = 'saved'
        doc.lastSavedAt = Date.now()
        doc.external = 'none'
        doc.draft = null
        this.clearDraftTimer()
        await this.gateway.deleteDraft(doc.path).catch(() => undefined)
        this.updateTitle()
        this.emit()
        return
      }

      if (result.status === 'unchanged') {
        doc.saveState = doc.dirty ? 'dirty' : 'saved'
        doc.lastSavedAt = Date.now()
        this.emit()
        return
      }

      if (result.status === 'conflict') {
        doc.external = 'conflict'
        doc.saveState = doc.dirty ? 'dirty' : 'saved'
        this.emit()
        this.notify('磁盘文件已被外部修改，未写入任何内容。')
        return
      }

      if (result.status === 'external-change') {
        doc.external = 'external-change'
        doc.saveState = 'saved'
        this.emit()
        this.notify('磁盘文件已变化；当前没有本地修改，可重新加载。')
        return
      }

      if (result.status === 'missing') {
        doc.saveState = 'error'
        this.emit()
        this.notify('原文件已不存在，未写入任何内容。')
        return
      }

      doc.saveState = 'error'
      this.emit()
      this.notify(result.message ?? '保存未完成。')
    } catch (error) {
      const code = (error as { code?: string }).code
      doc.saveState = 'error'
      if (code === 'disk-conflict') {
        doc.external = 'conflict'
        this.notify('保存冲突：磁盘文件在写入前发生了变化，未覆盖。')
      } else {
        this.notify(`保存失败：${(error as Error).message ?? String(error)}`)
      }
      this.emit()
    }
  }

  async keepLocalConflict(): Promise<void> {
    const doc = this.doc
    if (!doc || doc.readOnly || !doc.dirty || doc.external !== 'conflict') {
      return
    }
    if (!window.confirm('将用当前本地内容覆盖磁盘上的外部修改，此操作无法撤销。继续？')) {
      return
    }

    doc.saveState = 'saving'
    this.emit()
    try {
      const diskSha = await this.gateway.hashFile(doc.path)
      await this.gateway.writeDocument(doc.path, doc.buffer.currentBytes(), diskSha ?? '')
      const sha = doc.buffer.markSaved()
      doc.dirty = false
      doc.saveState = 'saved'
      doc.external = 'none'
      doc.draft = null
      doc.lastSavedAt = Date.now()
      this.clearDraftTimer()
      await this.gateway.deleteDraft(doc.path).catch(() => undefined)
      this.updateTitle()
      this.emit()
      this.notify(`已用本地内容覆盖磁盘文件（${sha.slice(0, 12)}）。`)
    } catch (error) {
      doc.saveState = doc.dirty ? 'dirty' : 'saved'
      if ((error as { code?: string }).code === 'disk-conflict') {
        this.notify('磁盘文件在覆盖前再次变化，未写入任何内容。')
      } else {
        this.notify(`覆盖失败：${(error as Error).message ?? String(error)}`)
      }
      this.emit()
    }
  }

  async applyDraft(): Promise<void> {
    const doc = this.doc
    if (!doc?.draft) {
      return
    }
    const original = doc.buffer.current
    const draftSource = doc.draft.source
    const edit: SourceEdit = { from: 0, to: original.length, insert: draftSource }
    const result = doc.buffer.applyEdits([edit], 'S4')
    if (!result.applied) {
      this.notify('草稿与当前文件相同，无需恢复。')
      doc.draft = null
      this.emit()
      return
    }

    doc.tiptap = toTiptapDocument(projectDocument(doc.buffer.map))
    doc.loadId = ++this.loadCounter
    doc.epoch = this.nextEpoch()
    doc.outline = collectOutline(doc.tiptap)
    doc.dirty = doc.buffer.dirty
    doc.saveState = 'dirty'
    doc.chars = doc.buffer.current.length
    doc.words = countWords(doc.buffer.current)
    doc.draft = null
    this.mode = doc.readOnly ? 'source' : 'visual'
    this.updateTitle()
    this.emit()
    this.notify('已恢复草稿；保存后才会写回原文件。')
  }

  async discardDraft(): Promise<void> {
    const doc = this.doc
    if (!doc) {
      return
    }
    doc.draft = null
    await this.gateway.deleteDraft(doc.path).catch(() => undefined)
    this.emit()
  }

  async reloadFromDisk(): Promise<void> {
    if (!this.doc) {
      return
    }
    const path = this.doc.path
    await this.openPath(path)
  }

  async toggleTask(sourceId: string, checked: boolean): Promise<void> {
    const doc = this.doc
    if (!doc || doc.readOnly) {
      return
    }
    const result = setTaskChecked(doc.buffer, sourceId, checked)
    if (!result.applied) {
      this.notify(result.reason ?? '任务状态无法写回。')
      return
    }
    const projected = toTiptapDocument(projectDocument(doc.buffer.map))
    this.applyProjection(projected)
    this.afterSourceApplied()
  }

  scheduleDraft(): void {
    if (this.draftTimer) {
      clearTimeout(this.draftTimer)
    }
    this.draftTimer = setTimeout(() => {
      void this.writeDraft()
    }, 1200)
  }

  private async writeDraft(): Promise<void> {
    const doc = this.doc
    if (!doc || !doc.dirty || doc.readOnly) {
      return
    }
    try {
      await this.gateway.writeDraft({
        path: doc.path,
        source: doc.buffer.current,
        baselineSha256: doc.buffer.baselineSha256,
        updatedAt: new Date().toISOString(),
      })
    } catch {
      // Draft persistence is best effort; the explicit save path stays authoritative.
    }
  }

  async flushDraft(): Promise<void> {
    if (this.draftTimer) {
      clearTimeout(this.draftTimer)
      this.draftTimer = null
    }
    await this.writeDraft()
  }

  private clearDraftTimer(): void {
    if (this.draftTimer) {
      clearTimeout(this.draftTimer)
      this.draftTimer = null
    }
  }

  private scheduleMeta(): void {
    if (this.metaTimer) {
      return
    }
    this.metaTimer = setTimeout(() => {
      this.metaTimer = null
      if (this.doc && this.mode === 'visual' && this.editor) {
        this.doc.outline = collectOutline(this.editor.getJSON())
      }
      this.emit()
    }, 250)
  }

  private addRecent(path: string): void {
    const name = basename(path)
    this.recent = [
      { path, name, openedAt: Date.now() },
      ...this.recent.filter(entry => entry.path !== path),
    ].slice(0, 10)
    this.persistRecent()
  }

  private persistRecent(): void {
    localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent))
  }

  private updateTitle(): void {
    if (this.doc) {
      document.title = `${this.doc.dirty ? '● ' : ''}${this.doc.name} — Y Note`
    } else {
      document.title = 'Y Note'
    }
  }

  private async startWatching(): Promise<void> {
    await this.stopWatching()
    const doc = this.doc
    if (!doc || !this.gateway.watchDocument) {
      return
    }
    try {
      const dispose = await this.gateway.watchDocument(doc.path, () => {
        if (this.doc === doc) {
          this.scheduleExternalRefresh()
        }
      })
      if (this.doc !== doc) {
        dispose()
        return
      }
      this.watchDispose = dispose
    } catch {
      this.notify('文件监听不可用；保存前仍会校验磁盘内容。')
    }
  }

  private async stopWatching(): Promise<void> {
    if (this.watchTimer) {
      clearTimeout(this.watchTimer)
      this.watchTimer = null
    }
    const dispose = this.watchDispose
    this.watchDispose = null
    if (dispose) {
      try {
        await dispose()
      } catch {
        // The watcher may already be gone after the window unloads.
      }
    }
  }

  private scheduleExternalRefresh(): void {
    if (this.watchTimer) {
      clearTimeout(this.watchTimer)
    }
    this.watchTimer = setTimeout(() => {
      this.watchTimer = null
      void this.refreshExternalState()
    }, 150)
  }

  private async refreshExternalState(): Promise<void> {
    const doc = this.doc
    if (!doc || this.watchBusy || doc.saveState === 'saving') {
      return
    }
    this.watchBusy = true
    try {
      const diskSha = await this.gateway.hashFile(doc.path)
      if (this.doc !== doc) {
        return
      }
      if (diskSha === null) {
        if (doc.external !== 'conflict') {
          doc.external = 'conflict'
          this.emit()
        }
        return
      }
      if (diskSha === doc.buffer.baselineSha256) {
        if (doc.external !== 'none') {
          doc.external = 'none'
          this.emit()
        }
      } else if (doc.external === 'none') {
        doc.external = doc.dirty ? 'conflict' : 'external-change'
        this.emit()
      }
    } catch {
      // Files can disappear while being replaced; the next explicit save reports it.
    } finally {
      this.watchBusy = false
    }
  }
}
