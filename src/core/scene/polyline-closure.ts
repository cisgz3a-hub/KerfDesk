// isClosedEnough — shared "closed enough to fill" predicate (M4,
// AUDIT-2026-06-10). Either the closed flag is set, or the polyline returns
// to within CLOSURE_EPS_MM of its starting point. The geometric half
// catches glyph contours whose source omitted Z (opentype.js v2) and any
// data-at-rest polylines whose closed flag was set incorrectly upstream.
// Shared by fill hatching and Convert to Bitmap so the two cannot disagree
// about which contours fill (Fill working while conversion produced an
// all-white bitmap was exactly that disagreement).

import type { Polyline } from './scene-object';

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
