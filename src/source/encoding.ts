import { sha256 } from './sha256.js'

import type { EolStyle, SourceEncoding, TrailingBytes } from './types.js'

export interface Gb18030Codec {
  decode(bytes: Uint8Array): string
  encode(text: string): Uint8Array
}

let gb18030Codec: Gb18030Codec | undefined

/**
 * Node injects an iconv-based codec so gb18030 round trips exactly. Browsers
 * can decode through TextDecoder but cannot verify re-encoding, so documents
 * opened there are marked read-only instead of risking a lossy save.
 */
export function registerGb18030Codec(codec: Gb18030Codec): void {
  gb18030Codec = codec
}

function decodeGb18030(bytes: Uint8Array): string {
  if (gb18030Codec) {
    return gb18030Codec.decode(bytes)
  }
  return new TextDecoder('gb18030', { fatal: false, ignoreBOM: true }).decode(bytes)
}

const UTF8_BOM = [0xef, 0xbb, 0xbf]
const UTF16LE_BOM = [0xff, 0xfe]
const UTF16BE_BOM = [0xfe, 0xff]

export interface DecodedSource {
  encoding: SourceEncoding
  source: string
  lossless: boolean
  reason?: 'unsupported-encoding' | 'lossy-decode'
}

function startsWithBytes(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) {
    return false
  }

  return prefix.every((value, index) => bytes[index] === value)
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const evenLength = bytes.length - (bytes.length % 2)
  const view = bytes.subarray(0, evenLength)
  const swapped = new Uint8Array(view.length)

  for (let index = 0; index < view.length; index += 2) {
    swapped[index] = (littleEndian ? view[index] : view[index + 1])!
    swapped[index + 1] = (littleEndian ? view[index + 1] : view[index])!
  }

  return new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true }).decode(swapped)
}

function decodeUtf16Sequential(bytes: Uint8Array, littleEndian: boolean): string {
  const chunks: string[] = []

  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const first = bytes[index]!
    const second = bytes[index + 1]!
    const unit = littleEndian ? first | (second << 8) : (first << 8) | second
    chunks.push(String.fromCharCode(unit))
  }

  return chunks.join('')
}

export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function encodeUtf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(text.length * 2)

  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index)
    if (littleEndian) {
      out[index * 2] = unit & 0xff
      out[index * 2 + 1] = unit >>> 8
    } else {
      out[index * 2] = unit >>> 8
      out[index * 2 + 1] = unit & 0xff
    }
  }

  return out
}

function withBom(bytes: Uint8Array, bom: number[]): Uint8Array {
  const out = new Uint8Array(bytes.length + bom.length)
  out.set(bom, 0)
  out.set(bytes, bom.length)
  return out
}

export function decodeSource(bytes: Uint8Array): DecodedSource {
  if (startsWithBytes(bytes, UTF8_BOM)) {
    try {
      const source = decodeUtf8(bytes.subarray(UTF8_BOM.length))
      return { encoding: 'utf-8-bom', source, lossless: true }
    } catch {
      return {
        encoding: 'utf-8-bom',
        source: new TextDecoder('utf-8', { ignoreBOM: true }).decode(
          bytes.subarray(UTF8_BOM.length),
        ),
        lossless: false,
        reason: 'lossy-decode',
      }
    }
  }

  if (startsWithBytes(bytes, UTF16LE_BOM) || startsWithBytes(bytes, UTF16BE_BOM)) {
    const littleEndian = startsWithBytes(bytes, UTF16LE_BOM)
    const body = bytes.subarray(2)
    const encoding: SourceEncoding = littleEndian ? 'utf-16le' : 'utf-16be'

    let source: string
    try {
      source = decodeUtf16(body, littleEndian)
    } catch {
      source = decodeUtf16Sequential(body, littleEndian)
    }

    const reencoded = encodeUtf16(source, littleEndian)
    const lossless =
      body.length % 2 === 0 &&
      reencoded.length === body.length &&
      reencoded.every((value, index) => value === body[index])

    return {
      encoding,
      source,
      lossless,
      ...(lossless ? {} : { reason: 'lossy-decode' as const }),
    }
  }

  try {
    const source = decodeUtf8(bytes)
    return { encoding: 'utf-8', source, lossless: true }
  } catch {
    // Not UTF-8; try gb18030 only if it round-trips byte-for-byte.
  }

  try {
    const source = decodeGb18030(bytes)
    if (!gb18030Codec) {
      return { encoding: 'gb18030', source, lossless: false, reason: 'lossy-decode' }
    }

    const reencoded = gb18030Codec.encode(source)
    const lossless =
      reencoded.length === bytes.length &&
      reencoded.every((value, index) => value === bytes[index])

    if (lossless) {
      return { encoding: 'gb18030', source, lossless: true }
    }

    return {
      encoding: 'gb18030',
      source,
      lossless: false,
      reason: 'lossy-decode',
    }
  } catch {
    return {
      encoding: 'utf-8',
      source: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes),
      lossless: false,
      reason: 'unsupported-encoding',
    }
  }
}

export function encodeSource(text: string, encoding: SourceEncoding): Uint8Array {
  switch (encoding) {
    case 'utf-8':
      return encodeUtf8(text)
    case 'utf-8-bom':
      return withBom(encodeUtf8(text), UTF8_BOM)
    case 'utf-16le':
      return withBom(encodeUtf16(text, true), UTF16LE_BOM)
    case 'utf-16be':
      return withBom(encodeUtf16(text, false), UTF16BE_BOM)
    case 'gb18030':
      if (!gb18030Codec) {
        throw new Error('gb18030 encoding is unavailable in this environment')
      }
      return gb18030Codec.encode(text)
    default:
      throw new Error(`Unsupported encoding: ${String(encoding)}`)
  }
}

export { sha256 }

export function sha256Text(text: string): string {
  return sha256(encodeUtf8(text))
}

export function detectEol(source: string): EolStyle {
  let crlf = 0
  let lf = 0
  let cr = 0

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\r') {
      if (source[index + 1] === '\n') {
        crlf += 1
        index += 1
      } else {
        cr += 1
      }
    } else if (char === '\n') {
      lf += 1
    }
  }

  const styles = [crlf, lf, cr].filter(count => count > 0).length
  if (styles === 0) {
    return 'LF'
  }
  if (styles > 1) {
    return 'mixed'
  }
  if (crlf > 0) {
    return 'CRLF'
  }
  if (cr > 0) {
    return 'CR'
  }
  return 'LF'
}

export function classifyTrailing(source: string): TrailingBytes {
  if (source.length === 0) {
    return 'none'
  }

  const match = /(?:\r\n|\n|\r)+$/.exec(source)
  if (!match) {
    return 'none'
  }

  let count = 0
  for (let index = 0; index < match[0].length; ) {
    if (match[0][index] === '\r' && match[0][index + 1] === '\n') {
      count += 1
      index += 2
    } else {
      count += 1
      index += 1
    }
  }

  return count === 1 ? 'single-newline' : 'original'
}

export function eolSequenceAt(source: string, offset: number): string {
  const clamped = Math.max(0, Math.min(offset, source.length))

  for (let index = clamped - 1; index >= 0; index -= 1) {
    if (source[index] === '\n') {
      return index > 0 && source[index - 1] === '\r' ? '\r\n' : '\n'
    }
    if (source[index] === '\r') {
      return source[index + 1] === '\n' ? '\r\n' : '\r'
    }
  }

  for (let index = clamped; index < source.length; index += 1) {
    if (source[index] === '\r') {
      return source[index + 1] === '\n' ? '\r\n' : '\r'
    }
    if (source[index] === '\n') {
      return '\n'
    }
  }

  return '\n'
}
