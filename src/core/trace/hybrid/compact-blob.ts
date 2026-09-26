// Compact blobs in the Line + fill tracer (ADR-443): short strokes that are
// really round dots a little wider than the Max stroke width.

import type { Vec2 } from '../../scene';
import type { InkMask } from '../centerline/distance-field';
import { densePoints, floodEightConnected, pathLength } from './stroke-geometry';

// A stroke shorter than this many gate widths may be a compact blob.
const BLOB_LENGTH_GATES = 2;
// How far (px) an island's digitised width may exceed the gate and still be
// a pen mark: one width quantum, the tracer's overwide tolerance.
const ISLAND_TOLERANCE_PX = 0.25;

// A round dot a little wider than the gate slips under the disc gate (its
// seed margin) and its width profile (too short, and its tapering ends pull
// the median down), and would burn as a hairline dash. A stroke that is short
// against the gate is such a blob, and its ink goes to the fill, when its
// middle holds a disc wider than the gate (the middle only: at a junction of
// gate-width lines the inscribed disc widens, which says nothing about the
// line), or when it is a small island of ink measurably wider across the
// stroke than the gate (a pixel dot's inscribed disc understates it).
export function isCompactBlob(
  points: ReadonlyArray<Vec2>,
  mask: InkMask,
  distSq: Float64Array,
  gate: { readonly gateRadius: number; readonly maxWidthPx: number },
): boolean {
  const length = pathLength(points);
  if (length >= BLOB_LENGTH_GATES * gate.maxWidthPx) return false;
  return (
    middleHoldsWideDisc(points, length, mask.width, distSq, gate) ||
    islandWiderThanGate(points, mask, gate.maxWidthPx)
  );
}

function middleHoldsWideDisc(
  points: ReadonlyArray<Vec2>,
  length: number,
  width: number,
  distSq: Float64Array,
  gate: { readonly gateRadius: number },
): boolean {
  const margin = Math.min(gate.gateRadius, length / 2);
  const gateSq = gate.gateRadius * gate.gateRadius;
  let along = 0;
  let previous: Vec2 | undefined;
  for (const p of densePoints(points)) {
    if (previous !== undefined) along += Math.hypot(p.x - previous.x, p.y - previous.y);
    previous = p;
    if (along < margin - 1e-9 || along > length - margin + 1e-9) continue;
    const i = Math.floor(p.y) * width + Math.floor(p.x);
    if ((distSq[i] ?? 0) > gateSq) return true;
  }
  return false;
}

// Width across the stroke's direction of the ink island the stroke lies in,
// or false when that island is not small (the stroke is part of a drawing).
// Pixel centres projected on the normal, plus one lattice step, give the
// island's digitised width the way the cross-section march would.
function islandWiderThanGate(
  points: ReadonlyArray<Vec2>,
  mask: InkMask,
  maxWidthPx: number,
): boolean {
  const first = points[0];
  const last = points.at(-1);
  const mid = points[Math.floor(points.length / 2)];
  if (first === undefined || last === undefined || mid === undefined) return false;
  const { width, height, ink } = mask;
  const start = Math.floor(mid.y) * width + Math.floor(mid.x);
  if (ink[start] !== 1) return false;
  const cap = Math.ceil((BLOB_LENGTH_GATES + 1) * maxWidthPx + 4) ** 2;
  const seen = new Set<number>([start]);
  const island = [start];
  floodEightConnected(width, height, island, (n) => {
    if (ink[n] !== 1 || seen.has(n) || seen.size > cap) return false;
    seen.add(n);
    return true;
  });
  if (seen.size > cap) return false;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const d = Math.hypot(dx, dy);
  const normal = d < 1e-6 ? { x: 0, y: 1 } : { x: -dy / d, y: dx / d };
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of island) {
    const x = i % width;
    const y = (i - x) / width;
    const along = (x + 0.5) * normal.x + (y + 0.5) * normal.y;
    lo = Math.min(lo, along);
    hi = Math.max(hi, along);
  }
  const across = hi - lo + Math.max(Math.abs(normal.x), Math.abs(normal.y));
  return across > maxWidthPx + ISLAND_TOLERANCE_PX;
}
