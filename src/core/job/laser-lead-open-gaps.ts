// Outlines left open (ADR-626 Amendment 10; meta audit v1 2026-10-23, M6-P1-3
// and M6-R1).
//
// Amendment 8 read open lines as closing a region only where their ends come
// within 0.5 mm of each other. A plate drawn as one open path whose corner was
// left 0.6 mm open closed nothing: the hole inside it was read as an outer
// contour, both its leads burned about 1.5 mm into the plate, and the plate
// lost its kerf offset, all without a word. A gap limit only says where
// detection stops; the plate is a plate at any gap.
//
// So an open path, or a chain of open paths whose ends meet as Join paths pairs
// them, is an outline when joining closes it, or when its two free ends lie
// closer together than OPEN_OUTLINE_SHARE of its length: it then runs nearly
// all the way round what it encloses, however wide the gap is in millimetres.
// Its region is the path closed by the straight line between its ends, as a
// fill closes an open path. A straight line, an L, a U with a whole side
// missing and an arc of less than about 330 degrees are not outlines.

import { joinCurveEndpointsWithin, type JoinableCurve } from '../geometry/path-endpoint-join';
import type { CurveSubpath, Vec2 } from '../scene';

/** An open outline's free ends lie closer together than this share of its
 * length. */
export const OPEN_OUTLINE_SHARE = 0.1;

export type OpenOutline = {
  /** The earliest source curve in the chain. */
  readonly index: number;
  /** The chain's points; its region closes them with a straight line. */
  readonly points: ReadonlyArray<Vec2>;
  /** How far apart its free ends are; 0 when joining closes it. */
  readonly gapMm: number;
};

/** The outlines among `curves`, joined where their ends meet within
 * `joinGapMm` (only curves with one signature join, as in Join paths). */
export function openOutlines(
  curves: ReadonlyArray<JoinableCurve>,
  joinGapMm: number,
): OpenOutline[] {
  const joined = joinCurveEndpointsWithin(curves, joinGapMm);
  const outlines: OpenOutline[] = [];
  curves.forEach((source, index) => {
    // A curve joined into an earlier one's chain is read with that chain.
    const replacement = joined.replacements.get(index);
    if (replacement === null) return;
    const outline = asOutline(replacement ?? source.curve, index);
    if (outline !== null) outlines.push(outline);
  });
  return outlines;
}

function asOutline(curve: CurveSubpath, index: number): OpenOutline | null {
  const points = [curve.start, ...curve.segments.map((segment) => segment.to)];
  if (!enclosesArea(points)) return null;
  if (curve.closed) return { index, points, gapMm: 0 };
  const first = points[0] as Vec2;
  const last = points[points.length - 1] as Vec2;
  const gapMm = Math.hypot(last.x - first.x, last.y - first.y);
  return gapMm <= OPEN_OUTLINE_SHARE * pathLengthMm(points) ? { index, points, gapMm } : null;
}

// Three points that are not on one line, so the closed path has an inside.
function enclosesArea(points: ReadonlyArray<Vec2>): boolean {
  const first = points[0];
  if (first === undefined) return false;
  let doubled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Vec2;
    const b = points[index] as Vec2;
    doubled += (a.x - first.x) * (b.y - first.y) - (b.x - first.x) * (a.y - first.y);
  }
  return Math.abs(doubled) > 0;
}

function pathLengthMm(points: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Vec2;
    const b = points[index] as Vec2;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}
