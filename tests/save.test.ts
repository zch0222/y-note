import { afterEach, describe, expect, it } from 'vitest'
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DiskConflictError, writeFileAtomic } from '../src/source/AtomicFile.js'
import { decodeSource, encodeSource, sha256 } from '../src/source/encoding.js'
import { openEnvelope } from '../src/source/Envelope.js'
import { createNodeSaveIO } from '../src/source/node-io.js'
import { SourceBuffer } from '../src/source/SourceBuffer.js'
import { planSave, saveDocument } from '../src/source/save.js'
import type { SaveIO } from '../src/source/save.js'
import { setSpanText } from '../src/source/patch.js'
import { walkSpans } from '../src/source/SourceMap.js'

const directories: string[] = []

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'y-note-save-'))
  directories.push(directory)
  return directory
}

async function writeDocument(
  source: string,
  encoding: 'utf-8' | 'utf-8-bom' = 'utf-8',
): Promise<{ path: string; buffer: SourceBuffer; bytes: Uint8Array }> {
  const directory = await tempDirectory()
  const path = join(directory, 'doc.md')
  const bytes = encodeSource(source, encoding)
  await writeFile(path, bytes)
  const buffer = new SourceBuffer(openEnvelope(path, bytes))
  return { path, buffer, bytes }
}

function editFirstText(buffer: SourceBuffer, from: string, to: string): void {
  const span = [...walkSpans(buffer.roots)].find(
    candidate => candidate.tokenType === 'text' && candidate.attrs?.value === from,
  )
  if (!span) {
    throw new Error(`No text span ${from}`)
  }
  setSpanText(buffer, span.id, to)
}

async function tempFiles(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter(name => name.includes('.ynote.tmp'))
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('save planning', () => {
  it('does not write a clean buffer', async () => {
    const { path, buffer, bytes } = await writeDocument('# T\n\npara\n')
    const io = createNodeSaveIO()
    let writes = 0
    const plan = await planSave(buffer, {
      read: io.read,
      write: async (...args) => {
        writes += 1
        return io.write(...args)
      },
    })

    expect(plan.status).toBe('unchanged')
    expect(plan.bytes).toBeUndefined()
    expect(writes).toBe(0)
    expect(await readFile(path)).toEqual(Buffer.from(bytes))
    expect(sha256(await readFile(path))).toBe(buffer.baselineSha256)
    expect(buffer.dirty).toBe(false)
  })

  it('plans a write only when both buffer and disk changed consistently', async () => {
    const { buffer } = await writeDocument('hello world\n')
    editFirstText(buffer, 'hello world', 'hello there')
    const plan = await planSave(buffer, createNodeSaveIO())
    expect(plan.status).toBe('write')
    expect(plan.bytes).toBeDefined()
    expect(plan.bytes).toEqual(buffer.currentBytes())
    expect(plan.currentSha256).not.toBe(plan.baselineSha256)
  })
})

describe('save execution', () => {
  it('writes edited bytes, updates the baseline and becomes clean', async () => {
    const { path, buffer } = await writeDocument('hello world\n')
    editFirstText(buffer, 'hello world', 'hello there')
    const result = await saveDocument(buffer, createNodeSaveIO())

    expect(result.status).toBe('write')
    expect(result.saved).toBe(true)
    const disk = await readFile(path)
    expect(disk.toString('utf8')).toBe('hello there\n')
    expect(sha256(disk)).toBe(result.sha256)
    expect(buffer.baselineSha256).toBe(result.sha256)
    expect(buffer.dirty).toBe(false)

    const again = await saveDocument(buffer, createNodeSaveIO())
    expect(again.status).toBe('unchanged')
    expect(again.saved).toBe(false)
  })

  it('preserves CRLF, BOM and missing final newline on save', async () => {
    const source = '# T\r\n\r\npara without final newline'
    const { path, buffer, bytes } = await writeDocument(source, 'utf-8-bom')
    editFirstText(buffer, 'para without final newline', 'para edited without final newline')
    await saveDocument(buffer, createNodeSaveIO())

    const disk = await readFile(path)
    expect(disk[0]).toBe(0xef)
    expect(disk[1]).toBe(0xbb)
    expect(disk[2]).toBe(0xbf)
    const decoded = decodeSource(new Uint8Array(disk))
    expect(decoded.encoding).toBe('utf-8-bom')
    expect(decoded.source).toBe('# T\r\n\r\npara edited without final newline')
    expect(decoded.source).not.toContain('\n\n\n')
    expect(decoded.source.includes('\r\n')).toBe(true)
    expect(decoded.source.replace(/\r\n/g, '')).not.toContain('\n')
    expect(bytes.length).toBeGreaterThan(0)
  })

  it('never clobbers an externally modified file when the buffer is dirty', async () => {
    const { path, buffer } = await writeDocument('original\n')
    editFirstText(buffer, 'original', 'local')
    await writeFile(path, 'external\n')

    const result = await saveDocument(buffer, createNodeSaveIO())
    expect(result.status).toBe('conflict')
    expect(result.saved).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('external\n')
    expect(buffer.current).toBe('local\n')
    expect(buffer.dirty).toBe(true)
  })

  it('reports an external change when the buffer is clean', async () => {
    const { path, buffer } = await writeDocument('original\n')
    await writeFile(path, 'external\n')

    const result = await saveDocument(buffer, createNodeSaveIO())
    expect(result.status).toBe('external-change')
    expect(result.saved).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('external\n')
  })

  it('reports a missing file without recreating it', async () => {
    const { path, buffer } = await writeDocument('original\n')
    editFirstText(buffer, 'original', 'local')
    await unlink(path)

    const result = await saveDocument(buffer, createNodeSaveIO())
    expect(result.status).toBe('missing')
    expect(result.saved).toBe(false)
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to save documents opened read-only', async () => {
    const directory = await tempDirectory()
    const path = join(directory, 'bad.md')
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0xff])
    await writeFile(path, bytes)
    const buffer = new SourceBuffer(openEnvelope(path, bytes))

    const result = await saveDocument(buffer, createNodeSaveIO())
    expect(result.status).toBe('read-only')
    expect(result.saved).toBe(false)
    expect(await readFile(path)).toEqual(Buffer.from(bytes))
  })

  it('keeps dirty state and the baseline when a write fails', async () => {
    const { path, buffer, bytes } = await writeDocument('original\n')
    editFirstText(buffer, 'original', 'local')
    const baseline = buffer.baselineSha256
    const failing: SaveIO = {
      read: createNodeSaveIO().read,
      write: async () => {
        throw new Error('disk full')
      },
    }

    await expect(saveDocument(buffer, failing)).rejects.toThrow('disk full')
    expect(buffer.dirty).toBe(true)
    expect(buffer.baselineSha256).toBe(baseline)
    expect(await readFile(path)).toEqual(Buffer.from(bytes))
  })

  it('detects a disk change that lands between planning and writing', async () => {
    const { path, buffer } = await writeDocument('original\n')
    editFirstText(buffer, 'original', 'local')
    const base = createNodeSaveIO()
    let reads = 0
    const racing: SaveIO = {
      async read(candidate) {
        const bytes = await base.read(candidate)
        if (reads === 0) {
          reads += 1
          await writeFile(path, 'external after plan\n')
        }
        return bytes
      },
      write: base.write,
    }

    const result = await saveDocument(buffer, racing)
    expect(result.status).toBe('conflict')
    expect(result.saved).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('external after plan\n')
    expect(buffer.dirty).toBe(true)
  })
})

describe('atomic file replacement', () => {
  it('creates a new file and leaves no temp artifacts', async () => {
    const directory = await tempDirectory()
    const path = join(directory, 'new.md')
    const bytes = encodeSource('new file\n', 'utf-8')
    const result = await writeFileAtomic(path, bytes)
    expect(result.sha256).toBe(sha256(bytes))
    expect(await readFile(path)).toEqual(Buffer.from(bytes))
    expect(await tempFiles(directory)).toEqual([])
  })

  it('replaces an existing file only with the expected digest', async () => {
    const directory = await tempDirectory()
    const path = join(directory, 'doc.md')
    await writeFile(path, 'old\n')
    const oldSha = sha256(encodeSource('old\n', 'utf-8'))
    const next = encodeSource('new\n', 'utf-8')

    await writeFileAtomic(path, next, { expectedSha256: oldSha })
    expect(await readFile(path, 'utf8')).toBe('new\n')

    await writeFile(path, 'external\n')
    await expect(
      writeFileAtomic(path, encodeSource('other\n', 'utf-8'), { expectedSha256: oldSha }),
    ).rejects.toBeInstanceOf(DiskConflictError)
    expect(await readFile(path, 'utf8')).toBe('external\n')
    expect(await tempFiles(directory)).toEqual([])
  })

  it('refuses to replace a symlink-like non-file or missing expected file', async () => {
    const directory = await tempDirectory()
    const path = join(directory, 'missing.md')
    await expect(
      writeFileAtomic(path, encodeSource('x', 'utf-8'), { expectedSha256: 'deadbeef' }),
    ).rejects.toBeInstanceOf(DiskConflictError)
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves the original file mode on POSIX', async () => {
    if (process.platform === 'win32') {
      return
    }
    const directory = await tempDirectory()
    const path = join(directory, 'mode.md')
    await writeFile(path, 'old\n')
    await chmod(path, 0o640)
    await writeFileAtomic(path, encodeSource('new\n', 'utf-8'))
    expect((await stat(path)).mode & 0o777).toBe(0o640)
  })
})
