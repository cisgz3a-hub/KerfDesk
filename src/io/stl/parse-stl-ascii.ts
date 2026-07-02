// Clean-room ASCII STL parser (Phase H.4, ADR-094). Grammar:
//
//   solid [name]
//     facet normal nx ny nz
//       outer loop
//         vertex x y z   (× 3)
//       endloop
//     endfacet
//   endsolid [name]
//
// Tokenizer-based and tolerant of whitespace/case; normals are ignored (the
// heightmap needs positions only). A facet with missing/non-numeric vertices
// is a hard error — silently dropping geometry would carve the wrong relief.

import { FLOATS_PER_TRIANGLE, type TriangleMesh } from '../../core/relief';
import { MAX_STL_TRIANGLES } from './parse-stl-binary';

export type AsciiStlResult =
  | { readonly kind: 'ok'; readonly mesh: TriangleMesh }
  | { readonly kind: 'error'; readonly reason: string };

const VERTICES_PER_FACET = 3;

export function looksLikeAsciiStl(text: string): boolean {
  const head = text.slice(0, 512).trimStart().toLowerCase();
  return head.startsWith('solid') && text.toLowerCase().includes('facet');
}

export function parseAsciiStl(text: string): AsciiStlResult {
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  const coords: number[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i]?.toLowerCase() !== 'vertex') {
      i += 1;
      continue;
    }
    const vertex = readVertex(tokens, i);
    if (vertex === null) {
      return { kind: 'error', reason: `Non-numeric vertex near token ${i}.` };
    }
    coords.push(vertex.x, vertex.y, vertex.z);
    i += 4;
    if (coords.length > MAX_STL_TRIANGLES * FLOATS_PER_TRIANGLE) {
      return { kind: 'error', reason: `ASCII STL exceeds the ${MAX_STL_TRIANGLES} facet limit.` };
    }
  }
  if (coords.length === 0) {
    return { kind: 'error', reason: 'ASCII STL contains no vertices.' };
  }
  if (coords.length % (VERTICES_PER_FACET * 3) !== 0) {
    return {
      kind: 'error',
      reason: `ASCII STL has a partial facet: ${coords.length / 3} vertices is not a multiple of 3.`,
    };
  }
  return { kind: 'ok', mesh: { positions: Float32Array.from(coords) } };
}

function readVertex(
  tokens: ReadonlyArray<string>,
  at: number,
): { x: number; y: number; z: number } | null {
  const x = Number.parseFloat(tokens[at + 1] ?? '');
  const y = Number.parseFloat(tokens[at + 2] ?? '');
  const z = Number.parseFloat(tokens[at + 3] ?? '');
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}
