// parseStl — format-sniffing entry point (Phase H.4, ADR-098). The classic
// trap: binary STLs whose 80-byte header happens to start with "solid". The
// binary length signature (declared count × 50 bytes matches the file size)
// is authoritative; ASCII is only attempted when the binary check fails.

import type { TriangleMesh } from '../../core/relief';
import { looksLikeAsciiStl, parseAsciiStl } from './parse-stl-ascii';
import { BINARY_STL_HEADER_BYTES, looksLikeBinaryStl, parseBinaryStl } from './parse-stl-binary';

export type ParseStlResult =
  | {
      readonly kind: 'ok';
      readonly mesh: TriangleMesh;
      readonly format: 'binary' | 'ascii';
    }
  | { readonly kind: 'error'; readonly reason: string };

export function parseStl(bytes: ArrayBuffer): ParseStlResult {
  if (looksLikeBinaryStl(bytes)) {
    const binary = parseBinaryStl(bytes);
    return binary.kind === 'ok' ? { kind: 'ok', mesh: binary.mesh, format: 'binary' } : binary;
  }
  const text = new TextDecoder().decode(bytes);
  if (looksLikeAsciiStl(text)) {
    const ascii = parseAsciiStl(text);
    return ascii.kind === 'ok' ? { kind: 'ok', mesh: ascii.mesh, format: 'ascii' } : ascii;
  }
  // Big enough to carry a binary header but the length signature failed —
  // report the SPECIFIC binary diagnosis (truncated/padded/over-limit)
  // instead of a generic "not an STL".
  if (bytes.byteLength >= BINARY_STL_HEADER_BYTES) {
    const binary = parseBinaryStl(bytes);
    return binary.kind === 'ok' ? { kind: 'ok', mesh: binary.mesh, format: 'binary' } : binary;
  }
  return {
    kind: 'error',
    reason: 'Not a recognizable STL: neither the binary length signature nor ASCII "solid" found.',
  };
}
