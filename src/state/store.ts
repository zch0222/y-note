import type { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'

import { EditorBridge, type SelectionHint } from '../editor/bridge.js'
import { renderPrintHtml } from '../editor/print.js'
import { collectOutline, countWords, toTiptapDocument } from '../editor/project.js'
import type { OutlineItem } from '../editor/project.js'
import { isExternalUrlAllowed } from '../platform/external.js'
import type { BlockAnalysis, DiffPreview } from '../source/analysis.js'
import { openEnvelope } from '../source/Envelope.js'
import { decodeSource, sha256 } from '../source/encoding.js'
import { setTaskChecked } from '../source/patch.js'
import { projectDocument } from '../source/projection.js'
import { SourceBuffer } from '../source/SourceBuffer.js'
import { saveDocument } from '../source/save.js'
import type { SaveIO } from '../source/save.js'
import type { EolStyle, ReadOnlyReason, SourceEncoding, SourceEdit } from '../source/types.js'
import { AnalysisClient } from '../workers/analysisClient.js'
import type {
  DocumentGateway,
  Draft,
  GitDiff,
  GitVersions,
  OpenedDocument,
  WorkspaceNode,
} from '../platform/types.js'

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'
export type ExternalState = 'none' | 'external-change' | 'conflict'
export type EditorMode = 'visual' | 'source'
export type Theme = 'light' | 'dark'
export type ThemePreference = Theme | 'system'
export type MotionPreference = 'system' | 'reduced'
export type Platform = 'windows' | 'macos' | 'linux'
export type Overlay = 'command' | 'settings' | 'shortcuts' | null
export type InspectorTab = 'outline' | 'diff'
export type DiffSource = 'git' | 'local'

export interface RecentFile {
  path: string
  name: string
  openedAt: number
}

export interface OpenMetrics {
  bytes: number
  blocks: number
  decodeMs: number
  indexMs: number
  projectMs: number
  totalMs: number
  analysis: 'worker' | 'main'
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

export interface ConfirmRequest {
  id: number
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  resolve: (value: boolean) => void
}

const RECENT_KEY = 'ynote.recent'
const THEME_KEY = 'ynote.theme'
const MOTION_KEY = 'ynote.motion'
const WORKSPACE_KEY = 'ynote.workspace'
const PANEL_KEY = 'ynote.panel'
const SIDEBAR_KEY = 'ynote.sidebar'

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') {
    return 'windows'
  }
  const agent = navigator.userAgent
  if (/Mac|iPhone|iPad/i.test(agent)) {
    return 'macos'
  }
  if (/Linux/i.test(agent)) {
    return 'linux'
  }
  return 'windows'
}

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
  readonly platform: Platform
  doc: DocState | null = null
  editor: Editor | null = null
  bridge: EditorBridge | null = null
  workspace: WorkspaceNode | null = null
  workspaceError: string | null = null
  recent: RecentFile[] = []
  theme: Theme = 'light'
  themePreference: ThemePreference = 'system'
  motionPreference: MotionPreference = 'system'
  mode: EditorMode = 'visual'
  inspectorTab: InspectorTab = 'outline'
  diffSource: DiffSource = 'git'
  panelOpen = true
  sidebarOpen = true
  sidebarFilter = ''
  overlay: Overlay = null
  confirmRequest: ConfirmRequest | null = null
  printHtml: string | null = null
  toast: Toast | null = null
  initialized = false
  git: GitDiff | null = null
  gitLoading = false
  gitError: string | null = null
  gitBlocks: BlockAnalysis | null = null
  gitAnalysisLoading = false
  gitAnalysisNote: string | null = null
  localDiff: DiffPreview | null = null
  localBlocks: BlockAnalysis | null = null
  localAnalysisLoading = false
  lastOpenMetrics: OpenMetrics | null = null
  private analysis = new AnalysisClient()
  private gitToken = 0
  private gitAnalysisToken = 0
  private localAnalysisToken = 0
  private localAnalysisTimer: ReturnType<typeof setTimeout> | null = null
  private epochCounter = 0
  private loadCounter = 0
  private draftTimer: ReturnType<typeof setTimeout> | null = null
  private metaTimer: ReturnType<typeof setTimeout> | null = null
  private toastTimer: ReturnType<typeof setTimeout> | null = null
  private watchDispose: (() => void | Promise<void>) | null = null
  private watchTimer: ReturnType<typeof setTimeout> | null = null
  private watchBusy = false
  private themeMedia: MediaQueryList | null = null

  constructor(gateway: DocumentGateway) {
    this.gateway = gateway
    this.platform = detectPlatform()
    this.recent = safeRead<RecentFile[]>(RECENT_KEY, [])
    const storedTheme = localStorage.getItem(THEME_KEY)
    this.themePreference =
      storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : 'system'
    const storedPanel = localStorage.getItem(PANEL_KEY)
    this.panelOpen = storedPanel !== 'closed'
    this.sidebarOpen = localStorage.getItem(SIDEBAR_KEY) !== 'closed'
    this.motionPreference = localStorage.getItem(MOTION_KEY) === 'reduced' ? 'reduced' : 'system'
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.themeMedia = window.matchMedia('(prefers-color-scheme: dark)')
      this.themeMedia.addEventListener('change', this.handleSystemTheme)
    }
    document.documentElement.dataset.platform = this.platform
    document.documentElement.dataset.runtime = gateway.kind
    this.applyTheme()
    this.applyMotion()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): number => this.version

  get analysisMode(): 'worker' | 'main' {
    return this.analysis.runsInWorker ? 'worker' : 'main'
  }

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
      const proceed = await this.askConfirm({
        title: '打开其他文件？',
        message:
          '当前文档有未保存的修改。继续打开其他文件？草稿已保留，可在重新打开时恢复。',
        confirmLabel: '继续打开',
        cancelLabel: '留在当前文档',
      })
      if (!proceed) {
        return
      }
    }

    this.resetGit()
    this.resetLocalAnalysis()
    const openStarted = performance.now()
    const envelope = openEnvelope(opened.path, opened.bytes)
    const decodedAt = performance.now()
    const indexed = await this.analysis.indexSource(envelope.source).catch(() => null)
    const indexedAt = performance.now()
    const buffer = new SourceBuffer(envelope, indexed ? { map: indexed } : {})
    const projectStarted = performance.now()
    const projected = projectDocument(buffer.map)
    const tiptap = toTiptapDocument(projected)
    const outline = collectOutline(tiptap)
    const projectMs = performance.now() - projectStarted
    const draft = await this.gateway.readDraft(opened.path).catch(() => null)
    const hasDraft = Boolean(draft && draft.source !== buffer.current)

    this.doc = {
      path: opened.path,
      name: basename(opened.path),
      directory: dirname(opened.path),
      buffer,
      tiptap,
      outline,
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
    this.lastOpenMetrics = {
      bytes: opened.bytes.byteLength,
      blocks: buffer.map.roots.filter(root => root.kind !== 'gap').length,
      decodeMs: decodedAt - openStarted,
      indexMs: indexedAt - decodedAt,
      projectMs,
      totalMs: performance.now() - openStarted,
      analysis: this.analysisMode,
    }
    this.emit()
    this.scheduleLocalAnalysis(0)
    void this.refreshGitDiff()
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

  setThemePreference(preference: ThemePreference): void {
    this.themePreference = preference
    localStorage.setItem(THEME_KEY, preference)
    this.applyTheme()
    this.emit()
  }

  setTheme(theme: Theme): void {
    this.setThemePreference(theme)
  }

  toggleTheme(): void {
    this.setThemePreference(this.theme === 'light' ? 'dark' : 'light')
  }

  setMotionPreference(preference: MotionPreference): void {
    this.motionPreference = preference
    localStorage.setItem(MOTION_KEY, preference)
    this.applyMotion()
    this.emit()
  }

  private applyTheme(): void {
    const systemDark = this.themeMedia?.matches ?? false
    this.theme =
      this.themePreference === 'system'
        ? systemDark
          ? 'dark'
          : 'light'
        : this.themePreference
    document.documentElement.dataset.theme = this.theme
  }

  private applyMotion(): void {
    document.documentElement.dataset.motion = this.motionPreference
  }

  private handleSystemTheme = (): void => {
    if (this.themePreference !== 'system') {
      return
    }
    this.applyTheme()
    this.emit()
  }

  focusEditor(): void {
    if (this.mode === 'visual' && this.editor) {
      this.editor.commands.focus()
      return
    }
    const source = document.querySelector<HTMLTextAreaElement>('[data-testid="source-editor"]')
    if (source) {
      source.focus()
      return
    }
    if (this.mode === 'visual' && this.doc?.readOnly) {
      document.getElementById('editor-pane')?.focus()
    }
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
    if (tab === 'diff' && this.doc) {
      void this.refreshGitDiff()
    }
  }

  setDiffSource(source: DiffSource): void {
    this.diffSource = source
    this.emit()
    if (source === 'git' && this.doc) {
      void this.refreshGitDiff()
    }
  }

  async refreshGitDiff(): Promise<void> {
    const doc = this.doc
    if (!doc || !this.gateway.readGitDiff) {
      this.git = null
      this.gitError = null
      this.gitLoading = false
      this.resetGitAnalysis()
      this.emit()
      return
    }

    const token = ++this.gitToken
    this.gitLoading = true
    this.gitError = null
    this.resetGitAnalysis()
    this.emit()
    try {
      const snapshot = await this.gateway.readGitDiff(doc.path)
      if (token !== this.gitToken || this.doc !== doc) {
        return
      }
      this.git = snapshot
      void this.analyzeGitBlocks(doc, snapshot, token)
    } catch (error) {
      if (token !== this.gitToken || this.doc !== doc) {
        return
      }
      this.git = null
      this.gitError = (error as Error).message ?? String(error)
    } finally {
      if (token === this.gitToken && this.doc === doc) {
        this.gitLoading = false
        this.emit()
      }
    }
  }

  private resetGit(): void {
    this.gitToken += 1
    this.git = null
    this.gitLoading = false
    this.gitError = null
    this.resetGitAnalysis()
  }

  private resetGitAnalysis(): void {
    this.gitAnalysisToken += 1
    this.gitBlocks = null
    this.gitAnalysisLoading = false
    this.gitAnalysisNote = null
  }

  private async analyzeGitBlocks(
    doc: DocState,
    snapshot: GitDiff,
    token: number,
  ): Promise<void> {
    if (
      snapshot.status === 'clean' ||
      snapshot.status === 'not-repo' ||
      snapshot.status === 'ignored' ||
      snapshot.binary
    ) {
      return
    }
    if (!this.gateway.readGitVersions) {
      this.gitAnalysisNote = '当前环境不支持块级 Git 分析。'
      this.emit()
      return
    }

    const analysisToken = this.gitAnalysisToken + 1
    this.gitAnalysisToken = analysisToken
    this.gitAnalysisLoading = true
    this.emit()

    try {
      const versions: GitVersions = await this.gateway.readGitVersions(doc.path)
      if (token !== this.gitToken || this.doc !== doc || analysisToken !== this.gitAnalysisToken) {
        return
      }
      if (versions.headTooLarge || versions.worktreeTooLarge) {
        this.gitAnalysisNote = '文件超过 8 MB，块级 Git 分析已跳过。'
        return
      }

      const head = versions.headBytes ? decodeSource(versions.headBytes) : null
      const worktree = versions.worktreeBytes ? decodeSource(versions.worktreeBytes) : null
      if ((head && !head.lossless) || (worktree && !worktree.lossless)) {
        this.gitAnalysisNote = 'Git 版本无法无损解码，块级摘要基于有损文本。'
      }

      const result = await this.analysis.analyzeBlocks(head?.source ?? '', worktree?.source ?? '')
      if (token !== this.gitToken || this.doc !== doc || analysisToken !== this.gitAnalysisToken) {
        return
      }
      this.gitBlocks = result
    } catch {
      if (token === this.gitToken && this.doc === doc && analysisToken === this.gitAnalysisToken) {
        this.gitAnalysisNote = '块级 Git 分析不可用。'
      }
    } finally {
      if (token === this.gitToken && this.doc === doc && analysisToken === this.gitAnalysisToken) {
        this.gitAnalysisLoading = false
        this.emit()
      }
    }
  }

  scheduleLocalAnalysis(delay = 500): void {
    const doc = this.doc
    if (!doc) {
      return
    }
    if (this.localAnalysisTimer) {
      clearTimeout(this.localAnalysisTimer)
      this.localAnalysisTimer = null
    }
    if (doc.buffer.savedText === doc.buffer.current) {
      const hadState =
        this.localDiff !== null || this.localBlocks !== null || this.localAnalysisLoading
      this.localAnalysisToken += 1
      this.localDiff = null
      this.localBlocks = null
      this.localAnalysisLoading = false
      if (hadState) {
        this.emit()
      }
      return
    }
    this.localAnalysisTimer = setTimeout(() => {
      this.localAnalysisTimer = null
      void this.computeLocalAnalysis()
    }, delay)
  }

  private async computeLocalAnalysis(): Promise<void> {
    const doc = this.doc
    if (!doc) {
      return
    }
    const before = doc.buffer.savedText
    const after = doc.buffer.current
    if (before === after) {
      this.localDiff = null
      this.localBlocks = null
      this.localAnalysisLoading = false
      this.emit()
      return
    }

    const token = this.localAnalysisToken + 1
    this.localAnalysisToken = token
    this.localAnalysisLoading = true
    this.emit()

    try {
      const result = await this.analysis.analyzeSourceChanges(before, after)
      if (token !== this.localAnalysisToken || this.doc !== doc) {
        return
      }
      this.localDiff = result.preview
      this.localBlocks = result.blocks
    } catch {
      if (token === this.localAnalysisToken && this.doc === doc) {
        this.localDiff = null
        this.localBlocks = null
      }
    } finally {
      if (token === this.localAnalysisToken && this.doc === doc) {
        this.localAnalysisLoading = false
        this.emit()
      }
    }
  }

  private resetLocalAnalysis(): void {
    if (this.localAnalysisTimer) {
      clearTimeout(this.localAnalysisTimer)
      this.localAnalysisTimer = null
    }
    this.localAnalysisToken += 1
    this.localDiff = null
    this.localBlocks = null
    this.localAnalysisLoading = false
  }

  togglePanel(): void {
    this.panelOpen = !this.panelOpen
    localStorage.setItem(PANEL_KEY, this.panelOpen ? 'open' : 'closed')
    this.emit()
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen
    localStorage.setItem(SIDEBAR_KEY, this.sidebarOpen ? 'open' : 'closed')
    this.emit()
  }

  openOverlay(overlay: Exclude<Overlay, null>): void {
    this.overlay = overlay
    this.emit()
  }

  askConfirm(
    options: Omit<ConfirmRequest, 'id' | 'resolve'>,
  ): Promise<boolean> {
    if (this.confirmRequest) {
      this.confirmRequest.resolve(false)
    }
    return new Promise(resolve => {
      this.confirmRequest = { ...options, id: Date.now(), resolve }
      this.emit()
    })
  }

  resolveConfirm(value: boolean): void {
    const request = this.confirmRequest
    if (!request) {
      return
    }
    this.confirmRequest = null
    this.emit()
    request.resolve(value)
  }

  closeOverlay(): void {
    if (!this.overlay) {
      return
    }
    this.overlay = null
    this.emit()
  }

  async openExternal(url: string): Promise<void> {
    if (!isExternalUrlAllowed(url)) {
      this.notify('只允许打开 http、https 或 mailto 链接。')
      return
    }
    if (!this.gateway.openExternal) {
      this.notify('当前环境不支持打开外部链接。')
      return
    }
    try {
      await this.gateway.openExternal(url)
    } catch (error) {
      this.notify(`无法打开外部链接：${(error as Error).message ?? String(error)}`)
    }
  }

  async printDocument(): Promise<void> {
    const doc = this.doc
    if (!doc) {
      return
    }
    if (this.printHtml !== null) {
      return
    }
    // The fast input path intentionally skips full Tiptap serialization, so the
    // source buffer (not doc.tiptap) is the authoritative print input.
    this.printHtml = renderPrintHtml(toTiptapDocument(projectDocument(doc.buffer.map)))
    this.emit()
    const nextFrame = () =>
      new Promise<void>(resolve => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => resolve())
        } else {
          setTimeout(resolve, 0)
        }
      })
    try {
      await nextFrame()
      await nextFrame()
      window.print()
    } finally {
      this.printHtml = null
      this.emit()
    }
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
    this.scheduleLocalAnalysis()
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
        this.scheduleLocalAnalysis(0)
        void this.refreshGitDiff()
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
        void this.refreshGitDiff()
        this.notify('磁盘文件已被外部修改，未写入任何内容。')
        return
      }

      if (result.status === 'external-change') {
        doc.external = 'external-change'
        doc.saveState = 'saved'
        this.emit()
        void this.refreshGitDiff()
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
    const proceed = await this.askConfirm({
      title: '保留我的草稿？',
      message: '将用当前本地内容覆盖磁盘上的外部修改，此操作无法撤销。',
      confirmLabel: '覆盖磁盘',
      cancelLabel: '取消',
      danger: true,
    })
    if (!proceed) {
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
      this.scheduleLocalAnalysis(0)
      void this.refreshGitDiff()
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
    this.scheduleLocalAnalysis(0)
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
      clearTimeout(this.metaTimer)
    }
    this.metaTimer = setTimeout(() => {
      this.metaTimer = null
      const doc = this.doc
      if (!doc) {
        return
      }
      if (this.mode === 'visual' && this.editor) {
        doc.outline = collectOutline(this.editor.getJSON())
      }
      doc.words = countWords(doc.buffer.current)
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
          void this.refreshGitDiff()
        }
        return
      }
      if (diskSha === doc.buffer.baselineSha256) {
        if (doc.external !== 'none') {
          doc.external = 'none'
          this.emit()
          void this.refreshGitDiff()
        }
      } else if (doc.external === 'none') {
        doc.external = doc.dirty ? 'conflict' : 'external-change'
        this.emit()
        void this.refreshGitDiff()
      }
    } catch {
      // Files can disappear while being replaced; the next explicit save reports it.
    } finally {
      this.watchBusy = false
    }
  }
}
