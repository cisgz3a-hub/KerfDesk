import {
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  applyTransform,
  flattenColoredPathCurves,
  type ColoredPath,
  type CncTabAnchor,
  type Polyline,
  type SceneObject,
  type Vec2,
} from '../scene';

const EPS = 1e-9;

type Projection = { readonly point: Vec2; readonly pathT: number; readonly distanceSq: number };
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
      const transformed: Polyline = {
        closed: true,
        points: polyline.points.map((point) => applyTransform(point, object.transform)),
      };
      const candidate = projectPointToPolyline(transformed, scenePoint);
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
  const measure = measurePolyline(polyline);
  if (measure === null) return null;
  let best: Projection | null = null;
  for (const edge of measure.edges) {
    const candidate = projectPointToEdge(point, edge, measure.total);
    if (best === null || candidate.distanceSq < best.distanceSq) best = candidate;
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

function projectPointToEdge(point: Vec2, edge: MeasuredEdge, total: number): Projection {
  const dx = edge.end.x - edge.start.x;
  const dy = edge.end.y - edge.start.y;
  const edgeT = Math.max(
    0,
    Math.min(
      1,
      ((point.x - edge.start.x) * dx + (point.y - edge.start.y) * dy) / (edge.length * edge.length),
    ),
  );
  const projected = interpolate(edge.start, edge.end, edgeT);
  return {
    point: projected,
    pathT: (edge.startDistance + edge.length * edgeT) / total,
    distanceSq: (point.x - projected.x) ** 2 + (point.y - projected.y) ** 2,
  };
}

function interpolate(start: Vec2, end: Vec2, t: number): Vec2 {
  return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
}

function resolvedPolylines(path: ColoredPath): ReadonlyArray<Polyline> {
  const flattened = flattenColoredPathCurves(path, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget: 100_000,
  });
  return flattened.kind === 'ok' ? flattened.polylines : path.polylines;
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
