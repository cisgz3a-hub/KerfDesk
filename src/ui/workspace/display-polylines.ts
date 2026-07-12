import {
  flattenColoredPathCurves,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
} from '../../core/scene';
import {
  countPolylineSegments,
  LARGE_SCENE_SEGMENT_THRESHOLD,
  strideForSegmentBudget,
} from './draw-complexity';

export type DisplayPolylines = {
  readonly polylines: ReadonlyArray<Polyline>;
  readonly isSimplified: boolean;
  readonly segmentCount: number;
};

export type DisplayPolylineCache = {
  readonly get: (polylines: ReadonlyArray<Polyline>, budget?: number) => DisplayPolylines;
  readonly getPath: (path: ColoredPath, toleranceMm: number, budget?: number) => DisplayPolylines;
};

type CacheEntry = DisplayPolylines & { readonly budget: number };
type CurveCacheEntry = CacheEntry & { readonly toleranceMm: number };

export function createDisplayPolylineCache(): DisplayPolylineCache {
  const bySource = new WeakMap<ReadonlyArray<Polyline>, CacheEntry>();
  const byCurves = new WeakMap<ReadonlyArray<CurveSubpath>, CurveCacheEntry>();
  return {
    get(polylines, budget = LARGE_SCENE_SEGMENT_THRESHOLD) {
      const cached = bySource.get(polylines);
      if (cached !== undefined && cached.budget === budget) return cached;
      const display = buildDisplayPolylines(polylines, budget);
      const entry: CacheEntry = { ...display, budget };
      bySource.set(polylines, entry);
      return entry;
    },
    getPath(path, toleranceMm, budget = LARGE_SCENE_SEGMENT_THRESHOLD) {
      if (path.curves === undefined) return this.get(path.polylines, budget);
      const cached = byCurves.get(path.curves);
      if (cached !== undefined && cached.budget === budget && cached.toleranceMm === toleranceMm) {
        return cached;
      }
      const flattened = flattenColoredPathCurves(path, {
        toleranceMm,
        segmentBudget: Math.max(budget, LARGE_SCENE_SEGMENT_THRESHOLD),
      });
      const polylines = flattened.kind === 'ok' ? flattened.polylines : path.polylines;
      const display = buildDisplayPolylines(polylines, budget);
      const entry: CurveCacheEntry = { ...display, budget, toleranceMm };
      byCurves.set(path.curves, entry);
      return entry;
    },
  };
}

export function buildDisplayPolylines(
  polylines: ReadonlyArray<Polyline>,
  budget: number = LARGE_SCENE_SEGMENT_THRESHOLD,
): DisplayPolylines {
  const segmentCount = countPolylineSegments(polylines);
  const stride = strideForSegmentBudget(segmentCount, budget);
  if (stride === 1) return { polylines, isSimplified: false, segmentCount };
  return {
    polylines: decimatePolylines(polylines, stride),
    isSimplified: true,
    segmentCount,
  };
}

// Keep every Nth VERTEX of each polyline (always including both endpoints,
// preserving the closed flag) so an over-budget scene draws coarse but
// CONNECTED shapes. The previous sampler kept every Nth SEGMENT as its own
// two-point polyline, which rendered a freshly traced logo as disconnected
// dashes — indistinguishable from broken geometry (2026-07-05 report).
function decimatePolylines(
  polylines: ReadonlyArray<Polyline>,
  stride: number,
): ReadonlyArray<Polyline> {
  return polylines.map((polyline) => {
    const points = polyline.points;
    if (points.length <= 2) return polyline;
    const kept: Polyline['points'][number][] = [];
    for (let i = 0; i < points.length; i += stride) {
      const p = points[i];
      if (p !== undefined) kept.push(p);
    }
    const last = points[points.length - 1];
    if (last !== undefined && kept[kept.length - 1] !== last) kept.push(last);
    return { closed: polyline.closed, points: kept };
  });
}
