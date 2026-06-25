// Divide-and-conquer recursion for the centerline tracer (ADR-058). Splits the
// skeleton across its LONGER dimension at the line with the fewest stroke
// crossings (so few strokes are cut, and each cut is clean), recurses, and
// collects the per-chunk border-crossing segments. The split line is shared by
// both halves, so a stroke crossing it produces the same crossing point on each
// side; the downstream chainBranches stitches those back into one polyline.
//
// This replaces the graph-walk extraction, whose 8-neighbour degree test
// over-reported junctions on curves and shattered smooth strokes. Original
// implementation of the divide-and-conquer technique; no third-party code.

import type { Vec2 } from '../scene';
import { type Chunk, chunkSegments } from './centerline-chunk';

const CHUNK_MAX_PX = 8;
const SPLIT_MARGIN_PX = 3;

export function traceSkeletonToSegments(mask: Uint8Array, width: number, height: number): Vec2[][] {
  return traceRegion(mask, width, { x: 0, y: 0, w: width, h: height });
}

type Seam = { readonly vertical: boolean; readonly at: number };

function traceRegion(mask: Uint8Array, width: number, c: Chunk): Vec2[][] {
  if (c.w <= CHUNK_MAX_PX && c.h <= CHUNK_MAX_PX) return chunkSegments(mask, width, c);
  const seam = findSeam(mask, width, c);
  if (seam === null) return chunkSegments(mask, width, c);
  const out: Vec2[][] = [];
  for (const half of splitAt(c, seam)) {
    if (hasInk(mask, width, half)) {
      for (const seg of traceRegion(mask, width, half)) out.push(seg);
    }
  }
  return out;
}

// Lowest-crossing split line across the longer dimension, nearest the centre.
function findSeam(mask: Uint8Array, width: number, c: Chunk): Seam | null {
  const vertical = c.w >= c.h;
  const span = vertical ? c.w : c.h;
  if (span < 2 * SPLIT_MARGIN_PX) return null;
  const base = vertical ? c.x : c.y;
  const centre = base + span / 2;
  let bestAt = -1;
  let bestCount = Number.POSITIVE_INFINITY;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let at = base + SPLIT_MARGIN_PX; at <= base + span - 1 - SPLIT_MARGIN_PX; at += 1) {
    const count = vertical
      ? lineCrossings(mask, width, at, c.y, c.h, true)
      : lineCrossings(mask, width, at, c.x, c.w, false);
    const dist = Math.abs(at - centre);
    if (count < bestCount || (count === bestCount && dist < bestDist)) {
      bestAt = at;
      bestCount = count;
      bestDist = dist;
    }
  }
  return bestAt < 0 ? null : { vertical, at: bestAt };
}

function lineCrossings(
  mask: Uint8Array,
  width: number,
  at: number,
  start: number,
  len: number,
  vertical: boolean,
): number {
  let count = 0;
  for (let k = start; k < start + len; k += 1) {
    const idx = vertical ? k * width + at : at * width + k;
    if ((mask[idx] ?? 0) === 1) count += 1;
  }
  return count;
}

// Both halves include the seam line, so a stroke crossing it gives the same
// crossing point on each side (for stitching).
function splitAt(c: Chunk, seam: Seam): [Chunk, Chunk] {
  if (seam.vertical) {
    return [
      { x: c.x, y: c.y, w: seam.at - c.x + 1, h: c.h },
      { x: seam.at, y: c.y, w: c.x + c.w - seam.at, h: c.h },
    ];
  }
  return [
    { x: c.x, y: c.y, w: c.w, h: seam.at - c.y + 1 },
    { x: c.x, y: seam.at, w: c.w, h: c.y + c.h - seam.at },
  ];
}

function hasInk(mask: Uint8Array, width: number, c: Chunk): boolean {
  for (let y = c.y; y < c.y + c.h; y += 1) {
    for (let x = c.x; x < c.x + c.w; x += 1) {
      if ((mask[y * width + x] ?? 0) === 1) return true;
    }
  }
  return false;
}
