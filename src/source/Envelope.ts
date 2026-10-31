import {
  classifyTrailing,
  decodeSource,
  detectEol,
  encodeSource,
  sha256,
} from './encoding.js'
import type { FileEnvelope } from './types.js'

export function openEnvelope(path: string, bytes: Uint8Array): FileEnvelope {
  const decoded = decodeSource(bytes)
  const digest = sha256(bytes)
  const readOnlyReason = decoded.lossless ? undefined : decoded.reason

  return {
    path,
    encoding: decoded.encoding,
    eol: detectEol(decoded.source),
    trailingBytes: classifyTrailing(decoded.source),
    originalSha256: digest,
    source: decoded.source,
    ...(readOnlyReason ? { readOnlyReason } : {}),
  }
}

export function openEnvelopeFromText(
  path: string,
  source: string,
  encoding: FileEnvelope['encoding'] = 'utf-8',
): FileEnvelope {
  return openEnvelope(path, encodeSource(source, encoding))
}

export function encodeEnvelope(envelope: FileEnvelope, source = envelope.source): Uint8Array {
  return encodeSource(source, envelope.encoding)
}

export function envelopeRoundTrips(envelope: FileEnvelope): boolean {
  if (envelope.readOnlyReason) {
    return false
  }

  return sha256(encodeEnvelope(envelope)) === envelope.originalSha256
}
