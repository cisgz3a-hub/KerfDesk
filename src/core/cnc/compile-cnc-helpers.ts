import { pointInPolygon } from '../geometry';
import type { CncPass } from '../job';
import type { CncCutType, CncLayerSettings, Polyline, Vec2 } from '../scene';

const MIN_FEED_MM_PER_MIN = 1;
const COORD_EPS = 1e-9;

export function contourPassFromPolyline(polyline: Polyline, zMm: number): CncPass {
  return { kind: 'contour', zMm, polyline: ensureRingClosure(polyline), closed: polyline.closed };
}

export function isProfileCutType(cutType: CncCutType): boolean {
  return (
    cutType === 'profile-outside' || cutType === 'profile-inside' || cutType === 'profile-on-path'
  );
}

// ADR-253: resolve the per-layer "retract between passes" flag to a concrete
// boolean for the emit group. Only profile and engrave ("line") cuts — whose
// passes re-plunge at the same XY — honor it (default ON); every other cut type
// keeps its own motion and compiles false, so its output stays byte-identical.
export function resolveRetractBetweenPasses(settings: CncLayerSettings): boolean {
  const eligible = isProfileCutType(settings.cutType) || settings.cutType === 'engrave';
  return eligible ? (settings.retractBetweenPasses ?? true) : false;
}

export function orderInnerFirst(polylines: ReadonlyArray<Polyline>): ReadonlyArray<Polyline> {
  const closedPolylines = polylines.filter(
    (polyline) => polyline.closed && polyline.points.length >= 3,
  );
  return polylines
    .map((polyline, index) => ({
      polyline,
      index,
      depth: containmentDepth(polyline, closedPolylines),
    }))
    .sort((a, b) => b.depth - a.depth || a.index - b.index)
    .map((entry) => entry.polyline);
}

export function capFeed(feedMmPerMin: number, maxFeed: number): number {
  if (!Number.isFinite(feedMmPerMin) || feedMmPerMin <= 0) return MIN_FEED_MM_PER_MIN;
  return Math.min(feedMmPerMin, maxFeed);
}

export function capSpindle(spindleRpm: number, spindleMaxRpm: number): number {
  if (!Number.isFinite(spindleRpm) || spindleRpm <= 0) return 0;
  return Math.min(spindleRpm, spindleMaxRpm);
}

function containmentDepth(polyline: Polyline, closed: ReadonlyArray<Polyline>): number {
  const probe = polyline.points[0];
  if (probe === undefined) return 0;
  let depth = 0;
  for (const candidate of closed) {
    if (candidate !== polyline && pointInPolygon(probe, candidate.points)) depth += 1;
  }
  return depth;
}

function ensureRingClosure(polyline: Polyline): ReadonlyArray<Vec2> {
  const first = polyline.points[0];
  const last = polyline.points[polyline.points.length - 1];
  if (!polyline.closed || first === undefined || last === undefined) return polyline.points;
  const alreadyClosed =
    Math.abs(first.x - last.x) <= COORD_EPS && Math.abs(first.y - last.y) <= COORD_EPS;
  return alreadyClosed ? polyline.points : [...polyline.points, first];
}
