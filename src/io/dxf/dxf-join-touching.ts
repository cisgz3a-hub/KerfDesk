// Touching open DXF pieces are one outline (ADR-626 Amendment 8, audit
// 2026-10-21 03-P2-9). CAD writes a plate as four LINE entities, or a slot as
// two LINEs and two ARCs, each its own entity; read alone, every piece is an
// open path, so the outline lost kerf compensation, inside-first order and
// laser leads, and a hole inside it was read as an outer contour. LightBurn
// closes such shapes on import; so does this, for ends that coincide.
//
// Pieces of one colour (one operation after import) join where an end meets
// exactly one other end within DXF_JOIN_TOLERANCE_MM, the rule Join paths
// uses (path-endpoint-join.ts): a T-junction or three ends at one point stay
// apart. A chain whose last end meets its first closes. The tolerance is the
// one a single entity whose ends meet already closes at (dxf-entities.ts): it
// absorbs float rounding, such as an ARC end computed from its angles against
// a LINE end written as a number, and leaves every drawn gap open. Wider gaps
// are for Join paths, and the leads and Job Review read them (Amendment 8).
//
// A LINE drawn twice meets itself at both ends, but closed it would be a loop
// with no area, which Kerf Offset drops. The shared pairing leaves such a chain
// as it was (ADR-486 Amendment 4), so both LINEs import open and burn as drawn.

import {
  joinCurveEndpointsWithin,
  type JoinableCurve,
} from '../../core/geometry/path-endpoint-join';
import { ARC_CHORD_TOLERANCE_MM } from '../../core/geometry/arc-sampling';
import { flattenCurveSubpath, type CurveSubpath, type Polyline } from '../../core/scene';
import { CLOSURE_EPS_MM } from '../../core/scene/polyline-closure';
import type { ColoredPolyline } from './dxf-expand';

/** Ends this close are one point. */
export const DXF_JOIN_TOLERANCE_MM = CLOSURE_EPS_MM;

export function joinTouchingDxfPieces(
  pieces: ReadonlyArray<ColoredPolyline>,
): ReadonlyArray<ColoredPolyline> {
  const open: Array<JoinableCurve & { readonly index: number }> = [];
  pieces.forEach((piece, index) => {
    if (piece.polyline.closed || piece.curve.closed || piece.curve.segments.length === 0) return;
    open.push({ curve: piece.curve, signature: piece.color, index });
  });
  if (open.length === 0) return pieces;
  const joined = joinCurveEndpointsWithin(open, DXF_JOIN_TOLERANCE_MM);
  if (joined.replacements.size === 0) return pieces;
  const replaced = new Map<number, ColoredPolyline | null>();
  for (const [at, curve] of joined.replacements) {
    const source = open[at];
    if (source === undefined) continue;
    const piece = pieces[source.index] as ColoredPolyline;
    replaced.set(source.index, curve === null ? null : joinedPiece(piece.color, curve));
  }
  return pieces.flatMap((piece, index) => {
    const replacement = replaced.get(index);
    if (replacement === undefined) return [piece];
    return replacement === null ? [] : [replacement];
  });
}

function joinedPiece(color: string, curve: CurveSubpath): ColoredPolyline {
  return { color, curve, polyline: joinedPolyline(curve) };
}

// The compatibility polyline, sampled as the DXF importer samples its arcs. A
// closed one drops the repeated seam point, as every closed DXF entity does.
function joinedPolyline(curve: CurveSubpath): Polyline {
  // No budget: the pieces were sampled already, so their chain fits too.
  const flattened = flattenCurveSubpath(curve, {
    toleranceMm: ARC_CHORD_TOLERANCE_MM,
    segmentBudget: Number.MAX_SAFE_INTEGER,
  });
  const points = flattened.kind === 'ok' ? flattened.polyline.points : [curve.start];
  const first = points[0];
  const last = points.at(-1);
  const seam =
    curve.closed &&
    points.length > 1 &&
    first !== undefined &&
    last !== undefined &&
    first.x === last.x &&
    first.y === last.y;
  return { points: seam ? points.slice(0, -1) : points, closed: curve.closed };
}
