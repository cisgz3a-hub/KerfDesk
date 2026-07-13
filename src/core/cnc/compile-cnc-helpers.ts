import type { Polyline, Vec2 } from '../scene';

const MIN_FEED_MM_PER_MIN = 1;

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

function pointInPolygon(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    if (a === undefined || b === undefined || a.y > point.y === b.y > point.y) continue;
    const xAtY = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}
