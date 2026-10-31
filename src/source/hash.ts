const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK_64 = 0xffffffffffffffffn

export function fingerprint(text: string): string {
  let hash = FNV_OFFSET

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    hash ^= BigInt(code & 0xff)
    hash = (hash * FNV_PRIME) & MASK_64
    hash ^= BigInt(code >>> 8)
    hash = (hash * FNV_PRIME) & MASK_64
  }

  return hash.toString(16).padStart(16, '0')
}
