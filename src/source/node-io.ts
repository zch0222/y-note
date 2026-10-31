import { readFile } from 'node:fs/promises'

import { writeFileAtomic, type AtomicWriteOptions } from './AtomicFile.js'
import type { SaveIO } from './save.js'

export function createNodeSaveIO(): SaveIO {
  return {
    async read(path: string): Promise<Uint8Array | null> {
      try {
        return new Uint8Array(await readFile(path))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null
        }
        throw error
      }
    },
    async write(path: string, bytes: Uint8Array, options?: AtomicWriteOptions): Promise<void> {
      await writeFileAtomic(path, bytes, options)
    },
  }
}
