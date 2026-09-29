import type { Polyline, Vec2 } from '../scene';
import { evenlyNestedShapes } from './tab-inner-shapes';

export type AutomaticTabsSettings = {
  readonly tabsEnabled: boolean;
  readonly tabSizeMm: number;
  readonly tabsPerShape: number;
  readonly tabSkipInnerShapes: boolean;
};

type Interval = {
  readonly start: number;
  readonly end: number;
};

type SplitContext = {
  readonly points: ReadonlyArray<Vec2>;
  readonly cumulative: ReadonlyArray<number>;
  readonly perimeter: number;
};

const MIN_CLOSED_POINTS = 3;
const EPS = 1e-9;

export function applyAutomaticTabsToPolylines(
  polylines: ReadonlyArray<Polyline>,
  settings: AutomaticTabsSettings,
): ReadonlyArray<Polyline> {
  if (!settings.tabsEnabled) return polylines;
  const count = Math.max(1, Math.floor(settings.tabsPerShape));
  const sizeMm = Number.isFinite(settings.tabSizeMm) ? Math.max(0, settings.tabSizeMm) : 0;
  if (sizeMm <= 0) return polylines;

  const eligible = tabEligibility(polylines, settings);
  const out: Polyline[] = [];
  for (let i = 0; i < polylines.length; i += 1) {
    const polyline = polylines[i];
    if (polyline === undefined) continue;
    if (eligible[i] !== true) {
      out.push(polyline);
      continue;
    }
    out.push(...splitClosedPolylineForTabs(polyline, count, sizeMm));
  }
  return out;
}

export function automaticTabAnchorPoints(
  polyline: Polyline,
  tabsPerShape: number,
): ReadonlyArray<Vec2> {
  if (!polyline.closed) return [];
  const context = splitContext(polyline);
  if (context === null) return [];
  const count = Math.max(1, Math.floor(tabsPerShape));
  const anchors: Vec2[] = [];
  for (let index = 0; index < count; index += 1) {
    anchors.push(
      pointAtDistance(
        context.points,
        context.cumulative,
        context.perimeter,
        ((index + 0.5) * context.perimeter) / count,
      ),
    );
  }
  return anchors;
}

export function splitClosedPolylineForTabsAtAnchors(
  polyline: Polyline,
  anchors: ReadonlyArray<Vec2>,
  sizeMm: number,
): ReadonlyArray<Polyline> {
  if (!polyline.closed || anchors.length === 0) return [polyline];
  const normalizedSize = Number.isFinite(sizeMm) ? Math.max(0, sizeMm) : 0;
  if (normalizedSize <= 0) return [polyline];
  const context = splitContext(polyline);
  if (context === null) return [polyline];
  if (normalizedSize >= context.perimeter) return [];
  const half = normalizedSize / 2;
  const skips = mergeIntervals(
    anchors.flatMap((anchor) => {
      const center = nearestDistanceOnClosedPolyline(context, anchor);
      return splitModuloInterval(center - half, center + half, context.perimeter);
    }),
  );
  return burnSegmentsBetweenTabs(context, skips);
}

// Per polyline: closed and, when inner shapes are skipped, not a hole: inside
// an even number of the other closed shapes of at least three points. The
// layer is decided in one pass (tab-inner-shapes.ts, ADR-494 Amendment 1).
function tabEligibility(
  polylines: ReadonlyArray<Polyline>,
  settings: AutomaticTabsSettings,
): ReadonlyArray<boolean> {
  if (!settings.tabSkipInnerShapes) return polylines.map((polyline) => polyline.closed);
  return evenlyNestedShapes(
    polylines.map((polyline) => {
      if (!polyline.closed) return null;
      const points = normalizeClosedPoints(polyline.points);
      return points.length < MIN_CLOSED_POINTS ? null : points;
    }),
  );
}

function splitClosedPolylineForTabs(
  polyline: Polyline,
  count: number,
  sizeMm: number,
): ReadonlyArray<Polyline> {
  const context = splitContext(polyline);
  if (context === null) return [polyline];
  if (sizeMm >= context.perimeter) return [];
  const skips = tabSkipIntervals(context.perimeter, count, sizeMm);
  if (skips.length === 0) return [polyline];
  return burnSegmentsBetweenTabs(context, skips);
}

export function applyManualTabsToPolyline(
  polyline: Polyline,
  centers: ReadonlyArray<number>,
  sizeMm: number,
): ReadonlyArray<Polyline> {
  const context = splitContext(polyline);
  if (context === null) return [polyline];
  if (sizeMm >= context.perimeter) return [];
  const half = sizeMm / 2;
  const intervals = centers.flatMap((center) => {
    const normalized = Number.isFinite(center) ? Math.max(0, Math.min(1, center)) : 0;
    const distance = normalized * context.perimeter;
    return splitModuloInterval(distance - half, distance + half, context.perimeter);
  });
  const skips = mergeIntervals(intervals);
  if (skips.length === 0) return [polyline];
  return burnSegmentsBetweenTabs(context, skips);
}

// Null only for geometry too degenerate to carry tabs (a "loop" without area).
// Coverage degeneracy is NOT handled here: when requested tab windows swallow
// the whole perimeter the split functions return NO segments, so the caller
// keeps the full loop as one bridge instead of cutting the part free (A5).
function splitContext(polyline: Polyline): SplitContext | null {
  const points = normalizeClosedPoints(polyline.points);
  if (points.length < MIN_CLOSED_POINTS) return null;
  const cumulative = cumulativeDistances(points);
  const perimeter = cumulative[cumulative.length - 1] ?? 0;
  return perimeter <= EPS ? null : { points, cumulative, perimeter };
}

function burnSegmentsBetweenTabs(
  context: SplitContext,
  skips: ReadonlyArray<Interval>,
): ReadonlyArray<Polyline> {
  const segments: Polyline[] = [];
  for (let i = 0; i < skips.length; i += 1) {
    const current = skips[i];
    const next = skips[(i + 1) % skips.length];
    if (current === undefined || next === undefined) continue;
    const start = current.end;
    const end = i === skips.length - 1 ? next.start + context.perimeter : next.start;
    if (end - start <= EPS) continue;
    const burnPoints = sampleInterval(
      context.points,
      context.cumulative,
      context.perimeter,
      start,
      end,
    );
    if (burnPoints.length >= 2) segments.push({ closed: false, points: burnPoints });
  }
  return segments;
}

function normalizeClosedPoints(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const out: Vec2[] = [];
  for (const point of points) {
    if (out.length > 0 && pointsEqual(out[out.length - 1] as Vec2, point)) continue;
    out.push(point);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first !== undefined && last !== undefined && pointsEqual(first, last)) out.pop();
  return out;
}

function cumulativeDistances(points: ReadonlyArray<Vec2>): ReadonlyArray<number> {
  const out = [0];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    out.push((out[out.length - 1] ?? 0) + distance(a, b));
  }
  return out;
}

function tabSkipIntervals(
  perimeter: number,
  count: number,
  sizeMm: number,
): ReadonlyArray<Interval> {
  const intervals: Interval[] = [];
  const half = sizeMm / 2;
  for (let i = 0; i < count; i += 1) {
    const center = ((i + 0.5) * perimeter) / count;
    intervals.push(...splitModuloInterval(center - half, center + half, perimeter));
  }
  return mergeIntervals(intervals);
}

function splitModuloInterval(
  start: number,
  end: number,
  perimeter: number,
): ReadonlyArray<Interval> {
  if (end - start >= perimeter) return [{ start: 0, end: perimeter }];
  const normalizedStart = modulo(start, perimeter);
  const normalizedEnd = normalizedStart + (end - start);
  if (normalizedEnd <= perimeter) return [{ start: normalizedStart, end: normalizedEnd }];
  return [
    { start: normalizedStart, end: perimeter },
    { start: 0, end: normalizedEnd - perimeter },
  ];
}

function mergeIntervals(intervals: ReadonlyArray<Interval>): ReadonlyArray<Interval> {
  const sorted = [...intervals]
    .filter((interval) => interval.end - interval.start > EPS)
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const interval of sorted) {
    const previous = out[out.length - 1];
    if (previous === undefined || interval.start > previous.end + EPS) {
      out.push(interval);
    } else {
      out[out.length - 1] = { start: previous.start, end: Math.max(previous.end, interval.end) };
    }
  }
  return out;
}

function sampleInterval(
  points: ReadonlyArray<Vec2>,
  cumulative: ReadonlyArray<number>,
  perimeter: number,
  start: number,
  end: number,
): ReadonlyArray<Vec2> {
  const out: Vec2[] = [pointAtDistance(points, cumulative, perimeter, start)];
  const firstCycle = Math.floor(start / perimeter);
  const lastCycle = Math.floor(end / perimeter);
  for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
    for (let i = 0; i < points.length; i += 1) {
      const vertexDistance = (cumulative[i] ?? 0) + cycle * perimeter;
      if (vertexDistance > start + EPS && vertexDistance < end - EPS) {
        out.push(points[i] as Vec2);
      }
    }
  }
  out.push(pointAtDistance(points, cumulative, perimeter, end));
  return dedupeConsecutive(out);
}

function pointAtDistance(
  points: ReadonlyArray<Vec2>,
  cumulative: ReadonlyArray<number>,
  perimeter: number,
  distanceMm: number,
): Vec2 {
  const d = modulo(distanceMm, perimeter);
  for (let i = 0; i < points.length; i += 1) {
    const edgeStart = cumulative[i] ?? 0;
    const edgeEnd = cumulative[i + 1] ?? perimeter;
    if (d > edgeEnd + EPS) continue;
    const a = points[i] as Vec2;
    const b = points[(i + 1) % points.length] as Vec2;
    const edgeLength = edgeEnd - edgeStart;
    if (edgeLength <= EPS) return a;
    const t = Math.max(0, Math.min(1, (d - edgeStart) / edgeLength));
    return { x: cleanCoord(a.x + (b.x - a.x) * t), y: cleanCoord(a.y + (b.y - a.y) * t) };
  }
  return points[0] as Vec2;
}

function nearestDistanceOnClosedPolyline(context: SplitContext, anchor: Vec2): number {
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  let bestPathDistance = 0;
  for (let index = 0; index < context.points.length; index += 1) {
    const start = context.points[index];
    const end = context.points[(index + 1) % context.points.length];
    if (start === undefined || end === undefined) continue;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared <= EPS
        ? 0
        : Math.max(
            0,
            Math.min(1, ((anchor.x - start.x) * dx + (anchor.y - start.y) * dy) / lengthSquared),
          );
    const projectedX = start.x + dx * t;
    const projectedY = start.y + dy * t;
    const distanceSquared = (anchor.x - projectedX) ** 2 + (anchor.y - projectedY) ** 2;
    if (distanceSquared < bestDistanceSquared - EPS) {
      bestDistanceSquared = distanceSquared;
      const edgeStart = context.cumulative[index] ?? 0;
      const edgeEnd = context.cumulative[index + 1] ?? edgeStart;
      bestPathDistance = edgeStart + (edgeEnd - edgeStart) * t;
    }
  }
  return bestPathDistance;
}

function dedupeConsecutive(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const out: Vec2[] = [];
  for (const point of points) {
    if (out.length === 0 || !pointsEqual(out[out.length - 1] as Vec2, point)) out.push(point);
  }
  return out;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function pointsEqual(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS;
}

function cleanCoord(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

// ADR-494 (LBG-C05): the laser Line tab layouts in tab-layout.ts (by spacing,
// click-placed, tab spans burned at reduced power) split contours with these
// same steps, so tabs placed by count stay byte-identical. Additive: nothing
// above changes.
export type { Interval as TabInterval, SplitContext as TabSplitContext };
export {
  burnSegmentsBetweenTabs,
  mergeIntervals as mergeTabIntervals,
  nearestDistanceOnClosedPolyline,
  sampleInterval as sampleTabInterval,
  splitContext as tabSplitContext,
  splitModuloInterval as splitTabInterval,
  tabEligibility,
};
