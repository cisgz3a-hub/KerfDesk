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
  readonly getFillPath: (
    path: ColoredPath,
    toleranceMm: number,
    budget?: number,
  ) => DisplayPolylines;
};

type CacheEntry = DisplayPolylines & { readonly budget: number };
type CurveCacheEntry = CacheEntry & { readonly toleranceMm: number };
type FillCacheEntry = CurveCacheEntry & { readonly compatibility: ReadonlyArray<Polyline> };

/**
 * Screen error, in device pixels, of a curve flattened for display at the
 * bottom of its zoom bucket; at the top of the bucket it is twice this.
 */
export const DISPLAY_CURVE_MIN_ERROR_PX = 0.125;

/**
 * Tolerance, in the path's own millimetres, for flattening a curve drawn at
 * `pxPerMm` device pixels per millimetre (ADR-359 Amendment 2). The scale is
 * rounded down to a power of two, so the tolerance only changes when a zoom
 * crosses one, about every seven 1.1x wheel notches, and the curve is drawn
 * within 0.125 to 0.25 px of its true shape. Keying the display on the exact
 * scale flattened every cubic of a traced picture again on each notch.
 */
export function displayCurveToleranceMm(pxPerMm: number): number {
  return DISPLAY_CURVE_MIN_ERROR_PX / powerOfTwoAtOrBelow(Math.max(1e-9, pxPerMm));
}

function powerOfTwoAtOrBelow(value: number): number {
  let bucket = 2 ** Math.floor(Math.log2(value));
  // Math.log2 may round across a power of two; halving and doubling are exact.
  if (bucket > value) bucket /= 2;
  else if (bucket * 2 <= value) bucket *= 2;
  return bucket;
}

// Flattenings kept per curve array, most recently used first, so zooming back
// into a bucket the view just left draws its copy instead of flattening again.
const CURVE_TOLERANCE_ENTRIES = 3;

function takeRecent<T>(entries: T[] | undefined, matches: (entry: T) => boolean): T | undefined {
  const index = entries?.findIndex(matches) ?? -1;
  if (entries === undefined || index < 0) return undefined;
  const [entry] = entries.splice(index, 1);
  if (entry !== undefined) entries.unshift(entry);
  return entry;
}

function rememberRecent<K extends object, T>(recent: WeakMap<K, T[]>, key: K, entry: T): T {
  const entries = recent.get(key) ?? [];
  entries.unshift(entry);
  entries.length = Math.min(entries.length, CURVE_TOLERANCE_ENTRIES);
  recent.set(key, entries);
  return entry;
}

export function createDisplayPolylineCache(): DisplayPolylineCache {
  const bySource = new WeakMap<ReadonlyArray<Polyline>, CacheEntry>();
  const byCurves = new WeakMap<ReadonlyArray<CurveSubpath>, CurveCacheEntry[]>();
  return {
    getFillPath: createFillDisplayCache(),
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
      // A path whose curves are all straight (a pen line, a polygon, a trace
      // contour that fell back to its samples) flattens to the same vertices
      // at every tolerance, so its display is zoom-invariant: keying it on the
      // tolerance re-flattened and re-decimated a million-point path on every
      // wheel notch. Traces usually keep fitted cubics (trace-curves.ts), so
      // they take the curved route below, keyed on the zoom's tolerance bucket.
      const linear = linearCurvePolylines(path.curves);
      if (linear !== null) return this.get(linear, budget);
      const recent = takeRecent(
        byCurves.get(path.curves),
        (entry) => entry.budget === budget && entry.toleranceMm === toleranceMm,
      );
      if (recent !== undefined) return recent;
      const flattened = flattenColoredPathCurves(path, {
        toleranceMm,
        segmentBudget: Math.max(budget, LARGE_SCENE_SEGMENT_THRESHOLD),
      });
      const polylines = flattened.kind === 'ok' ? flattened.polylines : path.polylines;
      const display = buildDisplayPolylines(polylines, budget);
      return rememberRecent(byCurves, path.curves, { ...display, budget, toleranceMm });
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
//
// Vertex decimation alone cannot bound a scene whose cost is the POLYLINE
// COUNT rather than the vertices inside each one: a 200 MB DXF of LINE
// entities arrives as millions of TWO-POINT polylines, and those have no
// interior vertices to drop, so the budget silently did nothing and the canvas
// built one moveTo/lineTo pair per entity every frame. Short polylines are
// therefore thinned as whole units — the only lever that reduces their cost —
// while anything with interior vertices keeps its shape and is decimated as
// before. Both paths set `isSimplified`, which surfaces the on-canvas
// large-scene notice, and neither affects emitted output.
const MIN_DECIMATABLE_POINTS = 3;

function decimatePolylines(
  polylines: ReadonlyArray<Polyline>,
  stride: number,
): ReadonlyArray<Polyline> {
  const kept: Polyline[] = [];
  let shortSeen = 0;
  for (const polyline of polylines) {
    const points = polyline.points;
    if (points.length < MIN_DECIMATABLE_POINTS) {
      // Thin whole short polylines, keeping every Nth.
      if (shortSeen % stride === 0) kept.push(polyline);
      shortSeen += 1;
      continue;
    }
    const keptPoints: Polyline['points'][number][] = [];
    for (let i = 0; i < points.length; i += stride) {
      const p = points[i];
      if (p !== undefined) keptPoints.push(p);
    }
    const last = points[points.length - 1];
    if (last !== undefined && keptPoints[keptPoints.length - 1] !== last) keptPoints.push(last);
    kept.push({ closed: polyline.closed, points: keptPoints });
  }
  return kept;
}

/** Closed boundaries determine filled topology. Only open strokes may be sampled. */
export function buildFillDisplayPolylines(
  polylines: ReadonlyArray<Polyline>,
  budget = LARGE_SCENE_SEGMENT_THRESHOLD,
): DisplayPolylines {
  const open = polylines.filter((polyline) => !polyline.closed);
  const display = buildDisplayPolylines(open, budget);
  return {
    polylines: display.isSimplified
      ? [...polylines.filter((polyline) => polyline.closed), ...display.polylines]
      : polylines,
    isSimplified: display.isSimplified,
    segmentCount: countPolylineSegments(polylines),
  };
}

function createFillDisplayCache() {
  const entries = new WeakMap<
    ReadonlyArray<Polyline> | ReadonlyArray<CurveSubpath>,
    FillCacheEntry[]
  >();
  return (path: ColoredPath, toleranceMm: number, budget = LARGE_SCENE_SEGMENT_THRESHOLD) => {
    const key = path.curves ?? path.polylines;
    const lineGeometry =
      path.curves === undefined ? path.polylines : linearCurvePolylines(path.curves);
    const zoomInvariant = lineGeometry !== null;
    const recent = takeRecent(
      entries.get(key),
      (cached) =>
        cached.budget === budget &&
        cached.compatibility === path.polylines &&
        (zoomInvariant || cached.toleranceMm === toleranceMm),
    );
    if (recent !== undefined) return recent;
    const flattened = lineGeometry ?? flattenForFill(path, toleranceMm, budget);
    const display = buildFillDisplayPolylines(flattened, budget);
    return rememberRecent(entries, key, {
      ...display,
      budget,
      toleranceMm,
      compatibility: path.polylines,
    });
  };
}

// Straight-only curves flatten to their own vertices at every tolerance. The
// materialized polylines are memoized per curve array so the stroke and fill
// display caches, and every zoom level, share one copy.
const linearCurveGeometry = new WeakMap<
  ReadonlyArray<CurveSubpath>,
  ReadonlyArray<Polyline> | null
>();

/** The polylines of an all-line curve array, or null when any segment bends. */
export function linearCurvePolylines(
  curves: ReadonlyArray<CurveSubpath>,
): ReadonlyArray<Polyline> | null {
  const cached = linearCurveGeometry.get(curves);
  if (cached !== undefined) return cached;
  const linear = curves.some((curve) => curve.segments.some((segment) => segment.kind !== 'line'))
    ? null
    : curves.map((curve) => {
        const points = [curve.start];
        for (const segment of curve.segments) points.push(segment.to);
        return { points, closed: curve.closed };
      });
  linearCurveGeometry.set(curves, linear);
  return linear;
}

function flattenForFill(
  path: ColoredPath,
  toleranceMm: number,
  budget: number,
): ReadonlyArray<Polyline> {
  const flattened = flattenColoredPathCurves(path, {
    toleranceMm,
    segmentBudget: Math.max(budget, LARGE_SCENE_SEGMENT_THRESHOLD),
  });
  return flattened.kind === 'ok' ? flattened.polylines : path.polylines;
}
