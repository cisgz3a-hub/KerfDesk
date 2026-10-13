import {
  applyTransform,
  flattenCurveSubpath,
  sceneLayerVisibility,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type Layer,
  type Polyline,
  type Scene,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';
import { traceContourBounds } from '../../core/trace/trace-part-bounds';
import { hitTestObject } from '../../core/scene/hit-test';
import { tracePartGroups } from '../state/trace-part-geometry';
import { displayCurveToleranceMm } from './display-polylines';

export type TracePartHit = {
  readonly objectId: string;
  readonly pathIndex: number;
  readonly subpathIndex: number;
};

// A screen-sized target remains precise when zooming into a dense trace.
const HIT_RADIUS_PX = 6;
type IndexedLine = {
  readonly line: Polyline;
  readonly bounds: Bounds;
  readonly curve?: CurveSubpath;
};
type NearestHit = { readonly hit: TracePartHit; readonly distance: number };
type PathHitPaint = 'hidden' | 'stroke' | 'fill';
type VectorObject = Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>;
const pathIndexCache = new WeakMap<ColoredPath, ReadonlyArray<IndexedLine>>();
const curveLineCache = new WeakMap<
  CurveSubpath,
  Array<{ readonly tolerance: number; readonly line: Polyline }>
>();

export function hitTracePart(
  scene: Scene,
  point: Vec2,
  pxToMm: number,
  wireframe = false,
): TracePartHit | null {
  if (!Number.isFinite(pxToMm) || pxToMm <= 0) return null;
  const visibility = sceneLayerVisibility.lookup(scene.layers);
  for (let index = scene.objects.length - 1; index >= 0; index -= 1) {
    const object = scene.objects[index];
    if (object === undefined || object.locked === true) continue;
    if (!sceneLayerVisibility.hasObject(object, visibility)) continue;
    if (!('paths' in object)) {
      // Ordinary bounds artwork occludes the pick inside its transformed rectangle.
      if (hitTestObject(visibility, object, point).kind === 'primary') return null;
      continue;
    }
    const hit = hitObjectPart(object, point, HIT_RADIUS_PX * pxToMm, scene.layers, (path) => {
      const { visible, operation } = sceneLayerVisibility.resolvePath(object, path, visibility);
      if (!visible) return 'hidden';
      // Match object-display: only an effective Fill operation paints an
      // interior. Orphan paths and wireframe artwork are visible strokes.
      return !wireframe &&
        operation !== undefined &&
        effectiveOperationForObject(operation, object).mode === 'fill'
        ? 'fill'
        : 'stroke';
    });
    // Reuse the painted paths, including holes and wireframe, for foreground
    // artwork. An empty vector bounding box must not hide a lower trace.
    if (hit !== null) return object.kind === 'traced-image' ? hit : null;
  }
  return null;
}

function hitObjectPart(
  object: VectorObject,
  point: Vec2,
  radius: number,
  layers: ReadonlyArray<Layer>,
  resolvePaint: (path: ColoredPath) => PathHitPaint,
): TracePartHit | null {
  const local = localPoint(object, point);
  if (local === null) return null;
  const padding =
    radius / Math.min(Math.abs(object.transform.scaleX), Math.abs(object.transform.scaleY));
  if (!insideBounds(local, object.bounds, padding)) return null;
  const objectScale = Math.max(
    Math.abs(object.transform.scaleX),
    Math.abs(object.transform.scaleY),
  );
  const tolerance = displayCurveToleranceMm((objectScale * HIT_RADIUS_PX) / radius);
  let nearest: NearestHit | null = null;
  // Paths paint in source order: a later colour is topmost at an overlap.
  for (let pathIndex = object.paths.length - 1; pathIndex >= 0; pathIndex -= 1) {
    const path = object.paths[pathIndex];
    if (path === undefined) continue;
    const paint = resolvePaint(path);
    if (paint === 'hidden') continue;
    const lines = indexedLines(path);
    nearest = nearestEdge(
      { object, lines, local, point, padding, radius, pathIndex, tolerance },
      nearest,
    );
    if (paint === 'fill') {
      const filled = filledPart(object, pathIndex, path, lines, local, tolerance, layers);
      // This painted region hides every lower path, including nearer edges.
      if (filled !== null) return nearest?.hit ?? filled;
    }
  }
  return nearest?.hit ?? null;
}

function nearestEdge(
  args: {
    readonly object: SceneObject;
    readonly lines: ReadonlyArray<IndexedLine>;
    readonly local: Vec2;
    readonly point: Vec2;
    readonly padding: number;
    readonly radius: number;
    readonly pathIndex: number;
    readonly tolerance: number;
  },
  nearest: NearestHit | null,
): NearestHit | null {
  let result = nearest;
  for (const [subpathIndex, entry] of args.lines.entries()) {
    if (!insideBounds(args.local, entry.bounds, args.padding)) continue;
    const distance = edgeDistance(args.object, visibleLine(entry, args.tolerance), args.point);
    if (distance > args.radius || (result !== null && distance >= result.distance)) continue;
    result = {
      hit: { objectId: args.object.id, pathIndex: args.pathIndex, subpathIndex },
      distance,
    };
  }
  return result;
}

function filledPart(
  object: VectorObject,
  pathIndex: number,
  path: ColoredPath,
  lines: ReadonlyArray<IndexedLine>,
  point: Vec2,
  tolerance: number,
  layers: ReadonlyArray<Layer>,
): TracePartHit | null {
  // Most clicks are on an edge. Only group the path for an interior hit; this
  // never constructs one scene object per contour of a large image.
  const windings = lines.map((entry) =>
    (entry.curve?.closed ?? entry.line.closed) && insideBounds(point, entry.bounds, 0)
      ? windingNumber(visibleLine(entry, tolerance).points, point)
      : 0,
  );
  // The canvas fills the entire compound path. Even separately editable
  // strokes can cancel one another after their operation changes to Fill.
  const total = windings.reduce((sum, winding) => sum + winding, 0);
  const fillRule = path.fillRule ?? (object.kind === 'text' ? 'nonzero' : 'evenodd');
  if (fillRule === 'nonzero' ? total === 0 : Math.abs(total) % 2 === 0) return null;
  if (object.kind !== 'traced-image')
    return {
      objectId: object.id,
      pathIndex,
      subpathIndex: windings.findIndex((value) => value !== 0),
    };
  for (const group of tracePartGroups(object, pathIndex, layers)) {
    const winding = group.reduce((sum, index) => sum + (windings[index] ?? 0), 0);
    const inside = path.fillRule === 'nonzero' ? winding !== 0 : Math.abs(winding) % 2 === 1;
    const subpathIndex = group[0];
    if (inside && subpathIndex !== undefined)
      return { objectId: object.id, pathIndex, subpathIndex };
  }
  return null;
}

function indexedLines(path: ColoredPath): ReadonlyArray<IndexedLine> {
  const cached = pathIndexCache.get(path);
  if (cached !== undefined) return cached;
  const entries =
    path.curves?.map((curve, index) => ({
      curve,
      line: path.polylines[index] ?? { points: [], closed: curve.closed },
      bounds: traceContourBounds(curve),
    })) ?? path.polylines.map((line) => ({ line, bounds: traceContourBounds(line) }));
  pathIndexCache.set(path, entries);
  return entries;
}

/** Only flatten contours whose bounds contain the pick, at the canvas zoom precision. */
function visibleLine(entry: IndexedLine, tolerance: number): Polyline {
  if (entry.curve === undefined) return entry.line;
  const recent = curveLineCache.get(entry.curve) ?? [];
  const cached = recent.find((value) => value.tolerance === tolerance);
  if (cached !== undefined) return cached.line;
  const flattened = flattenCurveSubpath(entry.curve, { toleranceMm: tolerance });
  const line = flattened.kind === 'ok' ? flattened.polyline : entry.line;
  recent.unshift({ tolerance, line });
  recent.length = Math.min(recent.length, 3);
  curveLineCache.set(entry.curve, recent);
  return line;
}

function localPoint(object: SceneObject, point: Vec2): Vec2 | null {
  const t = object.transform;
  if (t.scaleX === 0 || t.scaleY === 0) return null;
  const angle = (t.rotationDeg * Math.PI) / 180;
  const x = point.x - t.x,
    y = point.y - t.y;
  return {
    x: (x * Math.cos(angle) + y * Math.sin(angle)) / (t.scaleX * (t.mirrorX ? -1 : 1)),
    y: (-x * Math.sin(angle) + y * Math.cos(angle)) / (t.scaleY * (t.mirrorY ? -1 : 1)),
  };
}

function insideBounds(point: Vec2, bounds: Bounds, padding: number): boolean {
  return (
    point.x >= bounds.minX - padding &&
    point.x <= bounds.maxX + padding &&
    point.y >= bounds.minY - padding &&
    point.y <= bounds.maxY + padding
  );
}

function edgeDistance(object: SceneObject, line: Polyline, point: Vec2): number {
  let distance = Infinity;
  const previous = line.closed ? line.points.at(-1) : undefined;
  let a = previous === undefined ? undefined : applyTransform(previous, object.transform);
  for (const node of line.points) {
    const b = applyTransform(node, object.transform);
    if (a !== undefined) distance = Math.min(distance, segmentDistance(point, a, b));
    a = b;
  }
  return distance;
}

function segmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

function windingNumber(points: ReadonlyArray<Vec2>, point: Vec2): number {
  let winding = 0;
  let a = points.at(-1);
  for (const b of points) {
    if (a !== undefined) {
      const side = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
      if (a.y <= point.y && b.y > point.y && side > 0) winding += 1;
      else if (a.y > point.y && b.y <= point.y && side < 0) winding -= 1;
    }
    a = b;
  }
  return winding;
}
