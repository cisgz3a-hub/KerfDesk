// The polylines a click is measured against, and its distance to them.
//
// A curve is flattened finely enough for the reach of the click on the bed
// (ADR-196 Amendment 1). The reach is a screen distance, so zoomed in it is a
// few hundredths of a millimetre: chords cut for a 2 mm reach would then lie
// further from the drawn curve than the click may be, and a click on the line
// would miss it.

import { flattenColoredPathCurves } from './curve-path';
import type { ColoredPath, Polyline, Transform, Vec2 } from './scene-object';

/** How far from a line a click still picks it, for a caller with no view. */
export const DEFAULT_STROKE_HIT_TOLERANCE_MM = 2;

// A chord may lie this share of the reach from its curve, as the fixed 2 mm
// reach always allowed (0.25 mm).
const REACH_PER_CHORD_ERROR = 8;
const COARSEST_CHORD_MM = DEFAULT_STROKE_HIT_TOLERANCE_MM / REACH_PER_CHORD_ERROR;
// Each level halves the chord error. Twelve reach 0.06 micrometres in the
// object's own units, past any zoom and scale the workspace allows.
const FINEST_CHORD_LEVEL = 12;
const SEGMENT_BUDGET = 100_000;

// Hover and click hit tests flatten the same immutable paths on every pointer
// move, and chord-optimal flattening (ADR-453) costs several times the old
// midpoint splitter, so each path's hit polylines are kept while it lives: one
// set per level it has been asked for.
const cache = new WeakMap<ColoredPath, Map<number, ReadonlyArray<Polyline>>>();

/** The reach to use: the caller's when it is a usable distance. */
export function strokeReachMm(requested: number | undefined): number {
  return requested !== undefined && Number.isFinite(requested) && requested >= 0
    ? requested
    : DEFAULT_STROKE_HIT_TOLERANCE_MM;
}

/** The path's outlines in its own units, close enough to its curves for this reach. */
export function hitTestPolylines(
  path: ColoredPath,
  transform: Transform,
  reachMm: number,
): ReadonlyArray<Polyline> {
  // Nothing to flatten: every level is the path's own points.
  if (path.curves === undefined) return path.polylines;
  const level = chordLevel(transform, reachMm);
  let levels = cache.get(path);
  if (levels === undefined) {
    levels = new Map();
    cache.set(path, levels);
  }
  const cached = levels.get(level);
  if (cached !== undefined) return cached;
  const flattened = flattenColoredPathCurves(path, {
    toleranceMm: COARSEST_CHORD_MM / 2 ** level,
    segmentBudget: SEGMENT_BUDGET,
  });
  const polylines = flattened.kind === 'ok' ? flattened.polylines : path.polylines;
  levels.set(level, polylines);
  return polylines;
}

// The largest absolute axis scale bounds how far a chord error grows on the bed.
function chordLevel(transform: Transform, reachMm: number): number {
  const scale = Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleY));
  const wantedMm = reachMm / REACH_PER_CHORD_ERROR / scale;
  if (!Number.isFinite(wantedMm) || wantedMm <= 0) return FINEST_CHORD_LEVEL;
  const level = Math.ceil(Math.log2(COARSEST_CHORD_MM / wantedMm));
  return Math.max(0, Math.min(FINEST_CHORD_LEVEL, level));
}

/** Distance from the point to the nearest of the polyline's segments. */
export function distanceToPolyline(
  point: Vec2,
  points: ReadonlyArray<Vec2>,
  closed: boolean,
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    const distance = pointToSegmentDistance(point, a, b);
    if (distance < nearest) nearest = distance;
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (closed && first !== undefined && last !== undefined) {
    const distance = pointToSegmentDistance(point, last, first);
    if (distance < nearest) nearest = distance;
  }
  return nearest;
}

export function pointToSegmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  const closest = { x: a.x + t * dx, y: a.y + t * dy };
  return Math.hypot(point.x - closest.x, point.y - closest.y);
}
