// isClosedEnough — shared "closed enough to fill" predicate (M4,
// AUDIT-2026-06-10). Either the closed flag is set, or the polyline returns
// to within CLOSURE_EPS_MM of its starting point. The geometric half
// catches glyph contours whose source omitted Z (opentype.js v2) and any
// data-at-rest polylines whose closed flag was set incorrectly upstream.
// Shared by fill hatching and Convert to Bitmap so the two cannot disagree
// about which contours fill (Fill working while conversion produced an
// all-white bitmap was exactly that disagreement).

import type { Polyline, Vec2 } from './scene-object';

// Same epsilon as text-to-polylines.flattenPath uses.
export const CLOSURE_EPS_MM = 1e-4;

export function isClosedEnough(pl: Polyline): boolean {
  if (pl.points.length < 3) return false;
  if (pl.closed) return true;
  const first = pl.points[0];
  const last = pl.points[pl.points.length - 1];
  if (first === undefined || last === undefined) return false;
  return Math.abs(first.x - last.x) < CLOSURE_EPS_MM && Math.abs(first.y - last.y) < CLOSURE_EPS_MM;
}

// Ensure a closed polyline's point list returns to its start, so a consumer
// that walks the points edge-by-edge (the G-code cut emitter, which never reads
// the `closed` flag) draws the closing edge. No-op for open polylines and for
// closed ones that already repeat the first point (SVG, native shapes, text,
// kerf output, both trace engines). The gap it fills is producers that set
// `closed` but drop the seam vertex — every DXF entity does (dxf-entities pops
// it and trusts the flag; parse-dxf keeps it dropped) — where the emitter would
// otherwise omit the final edge and leave the cut part attached to the stock.
export function withClosingPoint(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
): ReadonlyArray<Vec2> {
  if (!closed || points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return points;
  if (Math.abs(first.x - last.x) < CLOSURE_EPS_MM && Math.abs(first.y - last.y) < CLOSURE_EPS_MM) {
    return points;
  }
  return [...points, first];
}
