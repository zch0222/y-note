import { sha256 } from './encoding.js'
import type { SourceBuffer } from './SourceBuffer.js'

export type SaveStatus =
  | 'unchanged'
  | 'write'
  | 'conflict'
  | 'external-change'
  | 'missing'
  | 'read-only'

export interface SaveWriteOptions {
  expectedSha256?: string
}

export interface SaveIO {
  /** Returns the current disk bytes, or null when the file does not exist. */
  read(path: string): Promise<Uint8Array | null>
  write(path: string, bytes: Uint8Array, options?: SaveWriteOptions): Promise<void>
}

export interface SavePlan {
  status: SaveStatus
  path: string
  baselineSha256: string
  currentSha256: string
  diskSha256?: string
  /** Only present when status is `write`. */
  bytes?: Uint8Array
  message?: string
}

export interface SaveResult extends SavePlan {
  saved: boolean
  /** Digest of the bytes now on disk and recorded as the new baseline. */
  sha256?: string
}

/**
 * Decides whether an explicit save may write, without touching the disk.
 * A clean buffer never writes; a dirty buffer only writes when the disk still
 * matches the baseline recorded at open or at the previous successful save.
 */
export async function planSave(buffer: SourceBuffer, io: SaveIO): Promise<SavePlan> {
  const path = buffer.envelope.path
  const bytes = buffer.currentBytes()
  const currentSha256 = sha256(bytes)
  const baselineSha256 = buffer.baselineSha256
  const base = { path, baselineSha256, currentSha256 }

  if (buffer.envelope.readOnlyReason) {
    return {
      ...base,
      status: 'read-only',
      message: `Document opened read-only (${buffer.envelope.readOnlyReason}).`,
    }
  }

  const diskBytes = await io.read(path)
  if (diskBytes === null) {
    return { ...base, status: 'missing', message: 'File no longer exists on disk.' }
  }

  const diskSha256 = sha256(diskBytes)
  if (diskSha256 !== baselineSha256) {
    if (currentSha256 === baselineSha256) {
      return {
        ...base,
        status: 'external-change',
        diskSha256,
        message: 'File changed on disk; buffer has no local edits.',
      }
    }
    return {
      ...base,
      status: 'conflict',
      diskSha256,
      message: 'File changed on disk and the buffer also has local edits.',
    }
  }

  if (currentSha256 === baselineSha256) {
    return { ...base, status: 'unchanged', diskSha256 }
  }

  return {
    ...base,
    status: 'write',
    diskSha256,
    bytes,
    message: 'Ready to write.',
  }
}

/**
 * Plans and performs an explicit save. `buffer.markSaved()` only runs after the
 * write succeeds, so a failed write keeps the baseline and dirty state intact.
 */
export async function saveDocument(buffer: SourceBuffer, io: SaveIO): Promise<SaveResult> {
  const plan = await planSave(buffer, io)
  if (plan.status !== 'write' || !plan.bytes) {
    return { ...plan, saved: false }
  }

  try {
    await io.write(plan.path, plan.bytes, { expectedSha256: plan.baselineSha256 })
  } catch (error) {
    if ((error as { code?: string } | undefined)?.code === 'disk-conflict') {
      const diskSha256 = await io
        .read(plan.path)
        .then(bytes => (bytes ? sha256(bytes) : undefined))
        .catch(() => undefined)
      return {
        ...plan,
        status: 'conflict',
        saved: false,
        ...(diskSha256 ? { diskSha256 } : {}),
        message: 'File changed on disk between planning and writing; nothing was written.',
      }
    }
    throw error
  }

  const sha256AfterSave = buffer.markSaved()
  return {
    ...plan,
    status: 'write',
    saved: true,
    baselineSha256: sha256AfterSave,
    diskSha256: sha256AfterSave,
    sha256: sha256AfterSave,
    bytes: undefined,
  }
}
