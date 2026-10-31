export interface WorkspaceNode {
  name: string
  path: string
  isDir: boolean
  children: WorkspaceNode[]
}

export interface Draft {
  path: string
  source: string
  baselineSha256: string
  updatedAt: string
}

export interface OpenedDocument {
  path: string
  bytes: Uint8Array
  sha256: string
}

export interface DocumentGateway {
  readonly kind: 'tauri' | 'web'
  openFile(): Promise<OpenedDocument | null>
  openWorkspace(): Promise<WorkspaceNode | null>
  readWorkspace(root: string): Promise<WorkspaceNode>
  readDocument(path: string): Promise<OpenedDocument>
  writeDocument(path: string, bytes: Uint8Array, expectedSha256: string): Promise<{ sha256: string }>
  hashFile(path: string): Promise<string | null>
  writeDraft(draft: Draft): Promise<void>
  readDraft(path: string): Promise<Draft | null>
  deleteDraft(path: string): Promise<void>
  /** Registers an already-opened document, used by browser-only demo buffers. */
  registerDocument?(document: OpenedDocument): Promise<void>
}
