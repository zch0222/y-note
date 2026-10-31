import { randomBytes } from 'node:crypto'
import { chmod, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { sha256 } from './encoding.js'

export interface AtomicWriteOptions {
  /** Refuse to replace the file unless the current disk content has this digest. */
  expectedSha256?: string
  /** Creation mode for a new file; an existing file always keeps its mode. */
  mode?: number
}

export interface AtomicWriteResult {
  path: string
  sha256: string
  mode: number
}

export class DiskConflictError extends Error {
  readonly code = 'disk-conflict'
  readonly path: string
  readonly expectedSha256: string
  readonly actualSha256: string

  constructor(path: string, expectedSha256: string, actualSha256: string) {
    super(
      `Refusing to overwrite ${path}: disk content changed (expected ${expectedSha256 || 'missing file'}, got ${actualSha256 || 'missing file'})`,
    )
    this.name = 'DiskConflictError'
    this.path = path
    this.expectedSha256 = expectedSha256
    this.actualSha256 = actualSha256
  }
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

async function readDiskSha(path: string): Promise<string> {
  try {
    return sha256(new Uint8Array(await readFile(path)))
  } catch (error) {
    if (isNotFound(error)) {
      return ''
    }
    throw error
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle
  try {
    handle = await open(directory, 'r')
    await handle.sync()
  } catch {
    // Directory fsync is unavailable on some platforms (notably Windows).
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export async function writeFileAtomic(
  path: string,
  bytes: Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<AtomicWriteResult> {
  let existingMode: number | undefined

  try {
    const info = await stat(path)
    if (!info.isFile()) {
      throw new Error(`Not a regular file: ${path}`)
    }
    existingMode = info.mode & 0o7777
  } catch (error) {
    if (!isNotFound(error)) {
      throw error
    }
  }

  if (options.expectedSha256 !== undefined) {
    const actualSha256 = await readDiskSha(path)
    if (actualSha256 !== options.expectedSha256) {
      throw new DiskConflictError(path, options.expectedSha256, actualSha256)
    }
  }

  const mode = existingMode ?? options.mode ?? 0o666
  const directory = dirname(path)
  const tempPath = join(
    directory,
    `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.ynote.tmp`,
  )

  let handle: FileHandle | undefined = await open(tempPath, 'wx', mode)
  let renamed = false

  try {
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = undefined

    if (existingMode !== undefined) {
      await chmod(tempPath, existingMode)
    }

    await rename(tempPath, path)
    renamed = true
    await syncDirectory(directory)
  } finally {
    await handle?.close().catch(() => undefined)
    if (!renamed) {
      await unlink(tempPath).catch(() => undefined)
    }
  }

  return { path, sha256: sha256(bytes), mode }
}
