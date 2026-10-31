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

export type GitStatus =
  | 'clean'
  | 'modified'
  | 'staged'
  | 'untracked'
  | 'deleted'
  | 'renamed'
  | 'ignored'
  | 'unborn'
  | 'not-repo'

export interface GitDiffLine {
  kind: 'context' | 'added' | 'removed'
  text: string
  oldLine: number | null
  newLine: number | null
}

export interface GitHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: GitDiffLine[]
}

export interface GitDiff {
  repoRoot: string | null
  branch: string | null
  head: string | null
  status: GitStatus
  additions: number
  deletions: number
  hunks: GitHunk[]
  binary: boolean
  truncated: boolean
  message: string | null
  renamedFrom?: string | null
}

/** HEAD and worktree bytes for block-level change classification. */
export interface GitVersions {
  headBytes: Uint8Array | null
  worktreeBytes: Uint8Array | null
  headTooLarge: boolean
  worktreeTooLarge: boolean
  renamedFrom: string | null
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
  /** Read-only HEAD-vs-worktree diff for the file's repository. */
  readGitDiff?(path: string): Promise<GitDiff>
  /** HEAD and worktree bytes used for block-level Git change summaries. */
  readGitVersions?(path: string): Promise<GitVersions>
  /** Watches one document; resolves with a disposer. Save-time SHA checks remain authoritative. */
  watchDocument?(path: string, onChanged: () => void): Promise<() => void | Promise<void>>
  /** Registers an already-opened document, used by browser-only demo buffers. */
  registerDocument?(document: OpenedDocument): Promise<void>
  /** Opens an http/https/mailto URL outside the application. */
  openExternal?(url: string): Promise<void>
  /** Debug builds only: authorizes a directory for automated native acceptance. */
  authorizeTestRoot?(root: string): Promise<void>
}
