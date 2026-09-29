import {
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  applyTransform,
  flattenColoredPathCurves,
  flattenCurveSubpath,
  type ColoredPath,
  type CncTabAnchor,
  type CurveSubpath,
  type Polyline,
  type SceneObject,
  type Vec2,
} from '../scene';

const EPS = 1e-9;

type Projection = { readonly point: Vec2; readonly pathT: number; readonly distanceSq: number };
type EdgeProjection = {
  readonly point: Vec2;
  readonly edgeT: number;
  readonly distanceSq: number;
};
type MeasuredEdge = {
  readonly start: Vec2;
  readonly end: Vec2;
  readonly length: number;
  readonly startDistance: number;
};
type PolylineMeasure = {
  readonly edges: ReadonlyArray<MeasuredEdge>;
  readonly total: number;
  readonly first: Vec2;
};

export function seedCncTabAnchors(
  object: SceneObject,
  layerColor: string,
  count: number,
): ReadonlyArray<CncTabAnchor> {
  if (!('paths' in object)) return object.cncTabAnchors ?? [];
  const preserved = (object.cncTabAnchors ?? []).filter(
    (anchor) => anchor.layerColor !== layerColor,
  );
  const existing = (object.cncTabAnchors ?? []).filter(
    (anchor) => anchor.layerColor === layerColor,
  );
  if (existing.length > 0) return object.cncTabAnchors ?? [];
  const perContour = Math.max(1, Math.floor(count));
  const seeded: CncTabAnchor[] = [];
  object.paths.forEach((path, pathIndex) => {
    if (path.color !== layerColor) return;
    resolvedPolylines(path).forEach((polyline, polylineIndex) => {
      if (!polyline.closed || normalizedClosedPoints(polyline).length < 3) return;
      for (let index = 0; index < perContour; index += 1) {
        seeded.push({
          layerColor,
          pathIndex,
          polylineIndex,
          pathT: (index + 0.5) / perContour,
        });
      }
    });
  });
  return [...preserved, ...seeded];
}

export function cncTabAnchorPosition(object: SceneObject, anchor: CncTabAnchor): Vec2 | null {
  if (!('paths' in object)) return null;
  const path = object.paths[anchor.pathIndex];
  if (path === undefined || path.color !== anchor.layerColor) return null;
  const polyline = resolvedPolylines(path)[anchor.polylineIndex];
  if (polyline === undefined || !polyline.closed) return null;
  const local = pointAtFraction(polyline, anchor.pathT);
  return local === null ? null : applyTransform(local, object.transform);
}

/** Replace saved positions only on the caller's eligible paths. Unanchored
 * contours remain automatic; opening the editor still uses keep-existing seeding. */
export function redistributeCncTabAnchors(
  object: SceneObject,
  pathIndexes: ReadonlySet<number>,
  count: number,
): ReadonlyArray<CncTabAnchor> {
  const original = object.cncTabAnchors ?? [];
  if (!('paths' in object) || !Number.isFinite(count) || count < 1) return original;
  const perContour = Math.floor(count);
  const replaced = new Set<CncTabAnchor>();
  const seeded: CncTabAnchor[] = [];
  object.paths.forEach((path, pathIndex) => {
    if (!pathIndexes.has(pathIndex)) return;
    const existing = original.filter(
      (anchor) => anchor.pathIndex === pathIndex && anchor.layerColor === path.color,
    );
    if (existing.length === 0) return;
    resolvedPolylines(path).forEach((polyline, polylineIndex) => {
      if (!polyline.closed || normalizedClosedPoints(polyline).length < 3) return;
      const anchors = existing.filter((anchor) => anchor.polylineIndex === polylineIndex);
      if (anchors.length === 0) return;
      anchors.forEach((anchor) => replaced.add(anchor));
      for (let index = 0; index < perContour; index += 1) {
        seeded.push({
          layerColor: path.color,
          pathIndex,
          polylineIndex,
          pathT: (index + 0.5) / perContour,
        });
      }
    });
  });
  if (replaced.size === 0) return original;
  const next = [...original.filter((anchor) => !replaced.has(anchor)), ...seeded];
  return JSON.stringify(next) === JSON.stringify(original) ? original : next;
}

/** How far along closed `curve` its node `nodeIndex` lies, as the fraction of
 * the contour's length that a tab anchor's `pathT` measures. Null for an open
 * curve, a missing node or a contour without length. */
export function closedCurveNodeFraction(curve: CurveSubpath, nodeIndex: number): number | null {
  if (!curve.closed || !Number.isInteger(nodeIndex) || nodeIndex < 0) return null;
  if (nodeIndex > curve.segments.length) return null;
  const whole = flattenAsTabsResolve(curve);
  const measure = whole === null ? null : measurePolyline(whole);
  // Flattening works segment by segment, so the lead-in to the node flattens
  // to the same points as the start of the whole contour, and its length is
  // the same running sum pointAtFraction walks.
  const lead = flattenAsTabsResolve({
    start: curve.start,
    segments: curve.segments.slice(0, nodeIndex),
    closed: false,
  });
  if (measure === null || lead === null) return null;
  return Math.min(1, openLength(lead.points) / measure.total);
}

/** Anchors after one closed contour is redrawn from the point `startFraction`
 * of its length along it (the node tool's Start and Break): each tab of that
 * contour keeps its place, and anchors on other contours are unchanged. */
export function restartedTabAnchors<A extends CncTabAnchor>(
  anchors: ReadonlyArray<A>,
  pathIndex: number,
  polylineIndex: number,
  startFraction: number,
): ReadonlyArray<A> {
  return anchors.map((anchor) => {
    if (anchor.pathIndex !== pathIndex || anchor.polylineIndex !== polylineIndex) return anchor;
    const shifted = Math.max(0, Math.min(1, anchor.pathT)) - startFraction;
    const pathT = shifted - Math.floor(shifted);
    return { ...anchor, pathT: pathT >= 1 ? 0 : pathT };
  });
}

/** How much of an open contour's length, once closed, the straight line from
 * its end back to its start takes: Close Path and Join close it that way, and
 * its tabs placed by hand wait for that. 0 for a closed contour; null for a
 * missing contour or one without length. */
export function closingLineFraction(path: ColoredPath, polylineIndex: number): number | null {
  const polyline = resolvedPolylines(path)[polylineIndex];
  if (polyline === undefined) return null;
  if (polyline.closed) return 0;
  const first = polyline.points[0];
  const last = polyline.points.at(-1);
  if (first === undefined || last === undefined) return null;
  const gap = Math.hypot(first.x - last.x, first.y - last.y);
  const closing = gap > EPS ? gap : 0;
  const total = openLength(polyline.points) + closing;
  return total <= EPS ? null : closing / total;
}

export function projectCncTabAnchor(
  object: SceneObject,
  layerColor: string,
  scenePoint: Vec2,
): CncTabAnchor | null {
  if (!('paths' in object)) return null;
  let best: (Projection & { readonly pathIndex: number; readonly polylineIndex: number }) | null =
    null;
  for (let pathIndex = 0; pathIndex < object.paths.length; pathIndex += 1) {
    const path = object.paths[pathIndex];
    if (path === undefined || path.color !== layerColor) continue;
    const polylines = resolvedPolylines(path);
    for (let polylineIndex = 0; polylineIndex < polylines.length; polylineIndex += 1) {
      const polyline = polylines[polylineIndex];
      if (polyline === undefined || !polyline.closed) continue;
      const candidate = projectPointToMeasuredPolyline(
        measurePolyline(polyline),
        scenePoint,
        object.transform,
      );
      if (candidate !== null && (best === null || candidate.distanceSq < best.distanceSq)) {
        best = { ...candidate, pathIndex, polylineIndex };
      }
    }
  }
  if (best === null) return null;
  return {
    layerColor,
    pathIndex: best.pathIndex,
    polylineIndex: best.polylineIndex,
    pathT: best.pathT,
  };
}

export function projectPointToPolyline(polyline: Polyline, point: Vec2): Projection | null {
  return projectPointToMeasuredPolyline(measurePolyline(polyline), point);
}

function projectPointToMeasuredPolyline(
  measure: PolylineMeasure | null,
  point: Vec2,
  transform?: SceneObject['transform'],
): Projection | null {
  if (measure === null) return null;
  let best: Projection | null = null;
  for (const edge of measure.edges) {
    const start = transform === undefined ? edge.start : applyTransform(edge.start, transform);
    const end = transform === undefined ? edge.end : applyTransform(edge.end, transform);
    const candidate = projectPointToEdge(point, start, end);
    if (candidate === null || (best !== null && candidate.distanceSq >= best.distanceSq)) continue;
    // Choose the nearest edge in the cursor's scene frame, but persist its
    // fraction of the original local perimeter, as cncTabAnchorPosition reads it.
    best = {
      point: candidate.point,
      pathT: (edge.startDistance + edge.length * candidate.edgeT) / measure.total,
      distanceSq: candidate.distanceSq,
    };
  }
  return best;
}

function pointAtFraction(polyline: Polyline, fraction: number): Vec2 | null {
  const measure = measurePolyline(polyline);
  if (measure === null) return null;
  const target = Math.max(0, Math.min(1, fraction)) * measure.total;
  for (const edge of measure.edges) {
    if (target > edge.startDistance + edge.length + EPS) continue;
    const edgeT = (target - edge.startDistance) / edge.length;
    return interpolate(edge.start, edge.end, edgeT);
  }
  return measure.first;
}

function measurePolyline(polyline: Polyline): PolylineMeasure | null {
  const points = normalizedClosedPoints(polyline);
  const first = points[0];
  if (first === undefined || points.length < 2) return null;
  const edgeCount = polyline.closed ? points.length : points.length - 1;
  const edges: MeasuredEdge[] = [];
  let total = 0;
  for (let index = 0; index < edgeCount; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (start === undefined || end === undefined) continue;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length <= EPS) continue;
    edges.push({ start, end, length, startDistance: total });
    total += length;
  }
  return total <= EPS ? null : { edges, total, first };
}

function projectPointToEdge(point: Vec2, start: Vec2, end: Vec2): EdgeProjection | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= EPS * EPS) return null;
  const edgeT = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq),
  );
  const projected = interpolate(start, end, edgeT);
  return {
    point: projected,
    edgeT,
    distanceSq: (point.x - projected.x) ** 2 + (point.y - projected.y) ** 2,
  };
}

function interpolate(start: Vec2, end: Vec2, t: number): Vec2 {
  return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
}

// A curve flattened as resolvedPolylines flattens a path's curves.
function flattenAsTabsResolve(curve: CurveSubpath): Polyline | null {
  const flattened = flattenCurveSubpath(curve, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget: Number.MAX_SAFE_INTEGER,
  });
  return flattened.kind === 'ok' ? flattened.polyline : null;
}

// The edges measurePolyline counts, without closing the run.
function openLength(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (start === undefined || end === undefined) continue;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length > EPS) total += length;
  }
  return total;
}

function resolvedPolylines(path: ColoredPath): ReadonlyArray<Polyline> {
  const flattened = flattenColoredPathCurves(path, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget: Number.MAX_SAFE_INTEGER,
  });
  if (flattened.kind !== 'ok') {
    throw new Error('Canonical tab geometry exceeded the JavaScript safe-integer budget.');
  }
  return flattened.polylines;
}

function normalizedClosedPoints(polyline: Polyline): ReadonlyArray<Vec2> {
  const points = [...polyline.points];
  const first = points[0];
  const last = points[points.length - 1];
  if (
    first !== undefined &&
    last !== undefined &&
    Math.abs(first.x - last.x) <= EPS &&
    Math.abs(first.y - last.y) <= EPS
  ) {
    points.pop();
  }
  return points;
}
