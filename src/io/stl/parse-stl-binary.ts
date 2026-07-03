// Clean-room binary STL parser (Phase H.4, ADR-098). Format: 80-byte header,
// uint32 LE triangle count, then 50-byte records — normal (3 × f32, ignored),
// three vertices (9 × f32), attribute byte count (u16, ignored). No parser
// library per the ADR-098 clean-room mandate.

import { FLOATS_PER_TRIANGLE, type TriangleMesh } from '../../core/relief';

export const BINARY_STL_HEADER_BYTES = 80;
export const BINARY_STL_RECORD_BYTES = 50;
const COUNT_BYTES = 4;
// ~5M triangles ≈ 180 MB of positions — beyond this the file is not a relief
// candidate and would only OOM the tab.
export const MAX_STL_TRIANGLES = 5_000_000;

export type BinaryStlResult =
  | { readonly kind: 'ok'; readonly mesh: TriangleMesh }
  | { readonly kind: 'error'; readonly reason: string };

// True when the byte length exactly matches the declared triangle count —
// the reliable binary signature (files starting with "solid" can still be
// binary; the length check wins).
export function looksLikeBinaryStl(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < BINARY_STL_HEADER_BYTES + COUNT_BYTES) return false;
  const view = new DataView(bytes);
  const count = view.getUint32(BINARY_STL_HEADER_BYTES, true);
  return (
    bytes.byteLength === BINARY_STL_HEADER_BYTES + COUNT_BYTES + count * BINARY_STL_RECORD_BYTES
  );
}

export function parseBinaryStl(bytes: ArrayBuffer): BinaryStlResult {
  if (bytes.byteLength < BINARY_STL_HEADER_BYTES + COUNT_BYTES) {
    return { kind: 'error', reason: 'File too small to be a binary STL.' };
  }
  const view = new DataView(bytes);
  const count = view.getUint32(BINARY_STL_HEADER_BYTES, true);
  if (count > MAX_STL_TRIANGLES) {
    return {
      kind: 'error',
      reason: `STL declares ${count} triangles — beyond the ${MAX_STL_TRIANGLES} limit.`,
    };
  }
  const expected = BINARY_STL_HEADER_BYTES + COUNT_BYTES + count * BINARY_STL_RECORD_BYTES;
  if (bytes.byteLength !== expected) {
    return {
      kind: 'error',
      reason:
        `Binary STL is truncated or padded: ${count} triangles need ${expected} bytes, ` +
        `file has ${bytes.byteLength}.`,
    };
  }
  const positions = new Float32Array(count * FLOATS_PER_TRIANGLE);
  let write = 0;
  for (let t = 0; t < count; t += 1) {
    // Skip the 12-byte normal; read the 9 vertex floats.
    const base = BINARY_STL_HEADER_BYTES + COUNT_BYTES + t * BINARY_STL_RECORD_BYTES + 12;
    for (let f = 0; f < FLOATS_PER_TRIANGLE; f += 1) {
      positions[write] = view.getFloat32(base + f * 4, true);
      write += 1;
    }
  }
  return { kind: 'ok', mesh: { positions } };
}
