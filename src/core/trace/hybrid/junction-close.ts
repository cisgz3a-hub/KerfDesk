// Line + fill junction closing, against the finished fill outline (ADR-443).
//
// reachIntoFill carries a cut stroke end one pixel on into the wide region,
// which covers the one-pixel bump a pen line raises on the wide region where
// it meets a shape. The contour finisher's corner dial (ADR-439) may smooth a
// deeper bump off the outline (a pen line as wide as the gate raises about
// two), leaving paper between the reached end and the fill. The outline is
// only known after the strokes, so this pass walks each cut end still outside
// it on along its arrival direction, in small steps and only over ink, and
// stops at the first point inside: the end touches the fill and burns at most
// one step past its edge.

import type { CurveSubpath, Polyline, Vec2 } from '../../scene';
import type { InkMask } from '../centerline/distance-field';
import { registerTraceCurve } from '../trace-curves';

// Walk step (px): the deepest a closed end lands past the outline.
const CLOSE_STEP_PX = 0.25;

export type JunctionStroke = {
  readonly curve: CurveSubpath;
  readonly polyline: Polyline;
  readonly startCut?: boolean;
  readonly endCut?: boolean;
};

/** Walk each cut end that lies outside `outlines` (even-odd) until it enters
 *  them, at most `maxWalkPx` and never off the ink. Other strokes are
 *  returned as the same object. */
export function closeJunctionGaps<T extends JunctionStroke>(
  strokes: ReadonlyArray<T>,
  outlines: ReadonlyArray<Polyline>,
  mask: InkMask,
  maxWalkPx: number,
): T[] {
  const rings = outlines.filter((ring) => ring.closed).map((ring) => ring.points);
  if (rings.length === 0) return [...strokes];
  const inside = (p: Vec2): boolean => rings.reduce((odd, ring) => odd !== inRing(p, ring), false);
  return strokes.map((stroke) => {
    let points = stroke.polyline.points;
    let curve = stroke.curve;
    const end = stroke.endCut === true ? walkEnd(points, inside, mask, maxWalkPx) : null;
    if (end !== null) {
      points = [...points, end];
      curve = { ...curve, segments: [...curve.segments, { kind: 'line', to: end }] };
    }
    const start =
      stroke.startCut === true ? walkEnd([...points].reverse(), inside, mask, maxWalkPx) : null;
    if (start !== null) {
      points = [start, ...points];
      curve = { ...curve, start, segments: [{ kind: 'line', to: curve.start }, ...curve.segments] };
    }
    if (end === null && start === null) return stroke;
    registerTraceCurve(points, curve);
    return { ...stroke, curve, polyline: { ...stroke.polyline, points } };
  });
}

// The first point along the arrival direction (over the last pixel) that lies
// inside, or null when the end is already inside or the walk leaves the ink.
function walkEnd(
  points: ReadonlyArray<Vec2>,
  inside: (p: Vec2) => boolean,
  mask: InkMask,
  maxWalkPx: number,
): Vec2 | null {
  const end = points.at(-1);
  if (end === undefined || inside(end)) return null;
  let back: Vec2 | undefined;
  for (let i = points.length - 2; i >= 0; i -= 1) {
    back = points[i];
    if (back !== undefined && Math.hypot(end.x - back.x, end.y - back.y) >= 1) break;
  }
  if (back === undefined) return null;
  const length = Math.hypot(end.x - back.x, end.y - back.y);
  if (length < 1e-6) return null;
  const ux = (end.x - back.x) / length;
  const uy = (end.y - back.y) / length;
  for (let d = CLOSE_STEP_PX; d <= maxWalkPx + 1e-9; d += CLOSE_STEP_PX) {
    const p = { x: end.x + ux * d, y: end.y + uy * d };
    if (!onInk(p, mask)) return null;
    if (inside(p)) return p;
  }
  return null;
}

function onInk(p: Vec2, mask: InkMask): boolean {
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  return (
    x >= 0 && y >= 0 && x < mask.width && y < mask.height && mask.ink[y * mask.width + x] === 1
  );
}

function inRing(p: Vec2, ring: ReadonlyArray<Vec2>): boolean {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (a === undefined || b === undefined) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      odd = !odd;
    }
  }
  return odd;
}
