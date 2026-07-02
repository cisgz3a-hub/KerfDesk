// profileToolpathPolylines — offset layer geometry by the tool radius so the
// cut edge lands on the drawn path (Easel's Outline cut types).
//
// Reuses the clipper2 kerf-offset wrapper: it orients contours by containment,
// so a positive delta grows outer boundaries while shrinking holes — which is
// exactly tool-radius compensation for "cut outside, part keeps its size"
// (holes get cut inside their boundary, so the hole keeps its size too).
// 'inside' is the mirror case. Open polylines cannot be side-offset — they are
// always cut on-path, matching Easel.

import { offsetClosedPolylinesForKerf } from '../geometry/kerf-offset';
import type { Polyline, Vec2 } from '../scene';

export type ProfileSide = 'outside' | 'inside' | 'on-path';

const MIN_CLOSED_POINTS = 3;

// clipper2 throws on any non-finite coordinate ("Scaled coordinate exceeds
// Number.MAX_SAFE_INTEGER"), which would crash the whole preview compile.
// A polyline carrying NaN/Infinity (seen live from a degenerate mid-drag
// draft shape) is unmachinable — drop it instead of forwarding the poison.
export function hasFinitePoints(polyline: Polyline): boolean {
  return polyline.points.every(isFinitePoint);
}

function isFinitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function profileToolpathPolylines(
  polylines: ReadonlyArray<Polyline>,
  side: ProfileSide,
  toolDiameterMm: number,
): ReadonlyArray<Polyline> {
  const closed: Polyline[] = [];
  const open: Polyline[] = [];
  for (const polyline of polylines) {
    if (!hasFinitePoints(polyline)) continue;
    if (polyline.closed && polyline.points.length >= MIN_CLOSED_POINTS) {
      closed.push(polyline);
    } else if (polyline.points.length >= 2) {
      open.push(polyline);
    }
  }
  const radius = Math.max(0, toolDiameterMm) / 2;
  const delta = side === 'outside' ? radius : side === 'inside' ? -radius : 0;
  const offsetClosed = delta === 0 ? closed : offsetClosedPolylinesForKerf(closed, delta);
  return [...offsetClosed, ...open];
}
