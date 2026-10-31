import { describe, expect, it } from 'vitest'

import {
  classifyTrailing,
  decodeSource,
  detectEol,
  encodeSource,
  eolSequenceAt,
  sha256,
  sha256Text,
} from '../src/source/encoding.js'
import {
  encodeEnvelope,
  envelopeRoundTrips,
  openEnvelope,
  openEnvelopeFromText,
} from '../src/source/Envelope.js'

const utf8 = (text: string) => new TextEncoder().encode(text)

describe('encoding detection', () => {
  it('detects plain UTF-8 without touching the text', () => {
    const bytes = utf8('中文 text\n')
    const decoded = decodeSource(bytes)
    expect(decoded.encoding).toBe('utf-8')
    expect(decoded.lossless).toBe(true)
    expect(decoded.source).toBe('中文 text\n')
    expect(encodeSource(decoded.source, decoded.encoding)).toEqual(bytes)
  })

  it('keeps a UTF-8 BOM out of the source text and restores it on encode', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('# title\n')])
    const decoded = decodeSource(bytes)
    expect(decoded.encoding).toBe('utf-8-bom')
    expect(decoded.source).toBe('# title\n')
    expect(decoded.lossless).toBe(true)
    expect(encodeSource(decoded.source, decoded.encoding)).toEqual(bytes)
  })

  it('round-trips UTF-16 little endian and big endian', () => {
    for (const encoding of ['utf-16le', 'utf-16be'] as const) {
      const bytes = encodeSource('中文 😀\n', encoding)
      const decoded = decodeSource(bytes)
      expect(decoded.encoding).toBe(encoding)
      expect(decoded.lossless).toBe(true)
      expect(decoded.source).toBe('中文 😀\n')
      expect(encodeSource(decoded.source, encoding)).toEqual(bytes)
    }
  })

  it('round-trips gb18030 only when bytes survive the trip', () => {
    const bytes = encodeSource('中文文本\n', 'gb18030')
    const decoded = decodeSource(bytes)
    expect(decoded.encoding).toBe('gb18030')
    expect(decoded.lossless).toBe(true)
    expect(decoded.source).toBe('中文文本\n')
    expect(encodeSource(decoded.source, 'gb18030')).toEqual(bytes)
  })

  it('marks undecodable bytes as lossy instead of guessing', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0xff, 0xff])
    const decoded = decodeSource(bytes)
    expect(decoded.lossless).toBe(false)
    expect(decoded.reason).toBeDefined()
  })

  it('computes the known SHA-256 of the empty string', () => {
    expect(sha256Text('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(sha256(new Uint8Array())).toBe(sha256Text(''))
  })
})

describe('eol and trailing bytes', () => {
  it.each([
    ['', 'LF'],
    ['plain', 'LF'],
    ['a\nb\n', 'LF'],
    ['a\r\nb\r\n', 'CRLF'],
    ['a\rb\r', 'CR'],
    ['a\nb\r\n', 'mixed'],
    ['a\r\nb\r', 'mixed'],
  ] as const)('detectEol(%j) === %s', (source, style) => {
    expect(detectEol(source)).toBe(style)
  })

  it.each([
    ['', 'none'],
    ['a', 'none'],
    ['a\n', 'single-newline'],
    ['a\r\n', 'single-newline'],
    ['a\r', 'single-newline'],
    ['a\n\n', 'original'],
    ['a\r\n\r\n', 'original'],
    ['a  ', 'none'],
  ] as const)('classifyTrailing(%j) === %s', (source, kind) => {
    expect(classifyTrailing(source)).toBe(kind)
  })

  it('finds the nearby EOL sequence for inserted lines', () => {
    expect(eolSequenceAt('a\nb', 3)).toBe('\n')
    expect(eolSequenceAt('a\r\nb', 4)).toBe('\r\n')
    expect(eolSequenceAt('a\rb', 3)).toBe('\r')
    expect(eolSequenceAt('no eol', 2)).toBe('\n')
  })
})

describe('file envelope', () => {
  it('preserves an LF document byte-for-byte', () => {
    const source = '# T\n\npara\n'
    const bytes = utf8(source)
    const envelope = openEnvelope('doc.md', bytes)
    expect(envelope.encoding).toBe('utf-8')
    expect(envelope.eol).toBe('LF')
    expect(envelope.trailingBytes).toBe('single-newline')
    expect(envelope.source).toBe(source)
    expect(envelope.originalSha256).toBe(sha256(bytes))
    expect(encodeEnvelope(envelope)).toEqual(bytes)
    expect(envelopeRoundTrips(envelope)).toBe(true)
  })

  it('preserves CRLF, BOM and a missing final newline together', () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...utf8('# T\r\n\r\npara without newline'),
    ])
    const envelope = openEnvelope('doc.md', bytes)
    expect(envelope.encoding).toBe('utf-8-bom')
    expect(envelope.eol).toBe('CRLF')
    expect(envelope.trailingBytes).toBe('none')
    expect(encodeEnvelope(envelope)).toEqual(bytes)
    expect(envelopeRoundTrips(envelope)).toBe(true)
  })

  it.each(['utf-16le', 'utf-16be', 'gb18030'] as const)(
    'preserves a %s document on open',
    encoding => {
      const bytes = encodeSource('# 标题\r\n\r\n正文', encoding)
      const envelope = openEnvelope('doc.md', bytes)
      expect(envelope.encoding).toBe(encoding)
      expect(envelope.source).toBe('# 标题\r\n\r\n正文')
      expect(encodeEnvelope(envelope)).toEqual(bytes)
      expect(envelopeRoundTrips(envelope)).toBe(true)
    },
  )

  it('marks lossy decodes as read-only', () => {
    const envelope = openEnvelope('doc.md', new Uint8Array([0xef, 0xbb, 0xbf, 0xff]))
    expect(envelope.readOnlyReason).toBeDefined()
    expect(envelopeRoundTrips(envelope)).toBe(false)
  })

  it('opens text without normalizing anything', () => {
    const source = 'no newline at end'
    const envelope = openEnvelopeFromText('doc.md', source)
    expect(envelope.source).toBe(source)
    expect(envelope.trailingBytes).toBe('none')
    expect(envelopeRoundTrips(envelope)).toBe(true)
  })
})
