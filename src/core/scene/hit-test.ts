// hitTest - given a point in scene-logical coordinates (mm), find the topmost
// SceneObject at that point. Pure: no DOM, no rendering. Used by the UI when
// the user clicks the canvas.
//
// Vector artwork is tested against its actual polylines so large outline
// shapes do not behave like invisible filled slabs over smaller nested shapes.

import type { Layer, LayerMode } from './layer';
import { effectiveOperationForObject } from './effective-operation';
import { fillPoolKey, pathFillOperations, type PathFillOperation } from './fill-operations';
import { isRegistrationBox } from './registration-layer';
import type { Scene } from './scene';
import type { Bounds, ColoredPath, Polyline, SceneObject, Transform, Vec2 } from './scene-object';
import { applyTransform } from './transform';
import { flattenColoredPathCurves } from './curve-path';
import { objectGeometryExtent } from './object-extent';
import {
  resolveVisibleOperationForPath,
  sceneLayerVisibilityLookup,
  sceneObjectHasVisibleLayerFromMap,
} from './visibility';

const VECTOR_STROKE_HIT_TOLERANCE_MM = 2;
const BOUNDS_EDGE_EPSILON_MM = 1e-9;

export type HitTestObjectResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'primary' }
  | { readonly kind: 'line-interior'; readonly area: number };

const NO_HIT: HitTestObjectResult = { kind: 'none' };

/**
 * Selection skips locked artwork. `includeLocked` is for display-only uses
 * (the hover colour pulse, ADR-620) where the piece under the pointer is the
 * answer even if it cannot be picked.
 */
export function hitTest(
  scene: Scene,
  point: Vec2,
  options: { readonly includeLocked?: boolean } = {},
): string | null {
  const layerByColor = sceneLayerVisibilityLookup(scene.layers);
  const pools = fillPoolParityAt(scene, layerByColor, point);
  let bestLineInterior: { readonly id: string; readonly area: number } | null = null;

  // Topmost first: later-added objects render on top so direct hits win first.
  for (let i = scene.objects.length - 1; i >= 0; i -= 1) {
    const obj = scene.objects[i];
    if (obj === undefined || !isHitCandidate(obj, layerByColor, options.includeLocked === true)) {
      continue;
    }

    const hit = hitTestObject(layerByColor, obj, point, pools);
    if (hit.kind === 'primary') return obj.id;
    if (
      hit.kind === 'line-interior' &&
      (bestLineInterior === null || hit.area < bestLineInterior.area)
    ) {
      bestLineInterior = { id: obj.id, area: hit.area };
    }
  }
  return bestLineInterior?.id ?? null;
}

function isHitCandidate(
  obj: SceneObject,
  layerByColor: ReadonlyMap<string, Layer>,
  includeLocked: boolean,
): boolean {
  if (obj.locked === true && !includeLocked) return false;
  return sceneObjectHasVisibleLayerFromMap(obj, layerByColor);
}

/**
 * `pools` (from `fillPoolParityAt`) makes a filled path solid only where its
 * Fill pool is (ADR-683 Amendment 1); without it each object stands alone.
 */
export function hitTestObject(
  layerByColor: ReadonlyMap<string, Layer>,
  obj: SceneObject,
  point: Vec2,
  pools?: FillPoolParity,
): HitTestObjectResult {
  const paths = vectorPathsFor(obj);
  if (paths === null) {
    return pointInTransformedObjectBounds(point, obj) ? { kind: 'primary' } : NO_HIT;
  }
  if (!pointInExpandedObjectBBox(point, obj, VECTOR_STROKE_HIT_TOLERANCE_MM)) return NO_HIT;
  // The canvas paints a jig box by itself, never in a pool (fill-pools.ts).
  const pooled = pools === undefined || isRegistrationBox(obj) ? undefined : pools;
  return hitVectorObject(layerByColor, obj, paths, point, pooled);
}

/** Whether a Fill pool covers the point an odd number of times, so the canvas paints it there. */
export type FillPoolParity = (fill: PathFillOperation) => boolean;

/**
 * A point that an even number of a Fill operation's objects cover is drawn
 * and burned empty (ADR-683), whichever object made the hole. Each pool is
 * counted once, when a filled path under the point first asks: every object
 * of it covering the point (its paths unioned, each by its own rule, as the
 * compiler burns one object) flips the parity.
 */
export function fillPoolParityAt(
  scene: Scene,
  layerByColor: ReadonlyMap<string, Layer>,
  point: Vec2,
): FillPoolParity {
  const parity = new Map<string, boolean>();
  return (fill) => {
    const key = fillPoolKey(fill);
    let odd = parity.get(key);
    if (odd === undefined) {
      const covering = scene.objects.filter((object) =>
        coversInPool(layerByColor, object, key, point),
      );
      odd = covering.length % 2 === 1;
      parity.set(key, odd);
    }
    return odd;
  };
}

function coversInPool(
  layerByColor: ReadonlyMap<string, Layer>,
  object: SceneObject,
  key: string,
  point: Vec2,
): boolean {
  const paths = vectorPathsFor(object);
  if (paths === null || isRegistrationBox(object)) return false;
  if (!pointInExpandedObjectBBox(point, object, VECTOR_STROKE_HIT_TOLERANCE_MM)) return false;
  // Winding in object space: a dense pool asks every member on each hover.
  const local = objectSpacePoint(point, object.transform);
  return (
    local !== null &&
    paths.some(
      (path) =>
        pathFillOperations(object, path, layerByColor).some((fill) => fillPoolKey(fill) === key) &&
        pointInFilledPath(object, path, hitTestPolylines(path), local),
    )
  );
}

// applyTransform undone. A mirror reverses winding, which neither rule minds.
function objectSpacePoint(point: Vec2, transform: Transform): Vec2 | null {
  if (transform.scaleX === 0 || transform.scaleY === 0) return null;
  const radians = (-transform.rotationDeg * Math.PI) / 180;
  const dx = point.x - transform.x;
  const dy = point.y - transform.y;
  const x = dx * Math.cos(radians) - dy * Math.sin(radians);
  const y = dx * Math.sin(radians) + dy * Math.cos(radians);
  return {
    x: (transform.mirrorX ? -x : x) / transform.scaleX,
    y: (transform.mirrorY ? -y : y) / transform.scaleY,
  };
}

function hitVectorObject(
  layerByColor: ReadonlyMap<string, Layer>,
  obj: SceneObject,
  paths: ReadonlyArray<ColoredPath>,
  point: Vec2,
  pools: FillPoolParity | undefined,
): HitTestObjectResult {
  let hasPolyline = false;
  let lineInteriorArea: number | null = null;
  for (const path of paths) {
    const resolution = resolveVisibleOperationForPath(obj, path, layerByColor);
    if (!resolution.visible) continue;
    const layer = resolution.operation;
    const mode = effectiveLayerMode(obj, layer);
    const polylines = worldPolylines(path, obj.transform);
    if (polylines.length === 0) continue;
    hasPolyline = true;
    const inPool = (): boolean => {
      if (pools === undefined || mode !== 'fill') return true;
      // A path no visible Fill operation owns has no pool, and stands alone.
      const fills = pathFillOperations(obj, path, layerByColor);
      return fills.length === 0 || fills.some(pools);
    };
    const hit = hitPath(obj, path, mode, polylines, point, inPool);
    if (hit.kind === 'primary') return hit;
    if (hit.kind === 'line-interior') {
      lineInteriorArea =
        lineInteriorArea === null ? hit.area : Math.min(lineInteriorArea, hit.area);
    }
  }
  // An empty vector has no rendered geometry. Its persisted bounds are useful
  // for diagnostics and repair, but must not turn invisible artwork into a
  // direct-hit slab over real objects underneath.
  if (!hasPolyline) return NO_HIT;
  return lineInteriorArea === null ? NO_HIT : { kind: 'line-interior', area: lineInteriorArea };
}

// Hover and click hit tests flatten the same immutable paths on every pointer
// move, and chord-optimal flattening (ADR-453) costs several times the old
// midpoint splitter, so each path's hit polylines are kept while it lives.
const hitTestPolylineCache = new WeakMap<ColoredPath, ReadonlyArray<Polyline>>();

function hitTestPolylines(path: ColoredPath): ReadonlyArray<Polyline> {
  const cached = hitTestPolylineCache.get(path);
  if (cached !== undefined) return cached;
  const flattened = flattenColoredPathCurves(path, {
    toleranceMm: VECTOR_STROKE_HIT_TOLERANCE_MM / 8,
    segmentBudget: 100_000,
  });
  const polylines = flattened.kind === 'ok' ? flattened.polylines : path.polylines;
  hitTestPolylineCache.set(path, polylines);
  return polylines;
}

// A filled path is solid only where the canvas fills it: by its own rule over
// all of its closed contours together (L8-P2-5), and where its Fill pool's
// parity is odd (a window cut by another object, or stacked copies that
// cancel). A point in one of its holes, like a point inside a Line shape, is
// only an interior hit (ADR-196), so any artwork the hole shows is picked first.
function hitPath(
  obj: SceneObject,
  path: ColoredPath,
  mode: LayerMode,
  polylines: ReadonlyArray<Polyline>,
  point: Vec2,
  inPool: () => boolean,
): HitTestObjectResult {
  if (polylines.some((polyline) => pointNearPolyline(point, polyline.points, polyline.closed))) {
    return { kind: 'primary' };
  }
  const closed = polylines.filter((polyline) => polyline.closed);
  if (!closed.some((polyline) => pointInPolygon(point, polyline.points))) return NO_HIT;
  if (
    (mode === 'fill' || mode === 'image') &&
    pointInFilledPath(obj, path, closed, point) &&
    inPool()
  ) {
    return { kind: 'primary' };
  }
  return { kind: 'line-interior', area: bboxArea(transformedBBox(obj)) };
}

function pointInFilledPath(
  obj: SceneObject,
  path: ColoredPath,
  polylines: ReadonlyArray<Polyline>,
  point: Vec2,
): boolean {
  let winding = 0;
  for (const polyline of polylines) {
    if (polyline.closed) winding += windingNumber(point, polyline.points);
  }
  const rule = path.fillRule ?? (obj.kind === 'text' ? 'nonzero' : 'evenodd');
  return rule === 'nonzero' ? winding !== 0 : winding % 2 !== 0;
}

function windingNumber(point: Vec2, polygon: ReadonlyArray<Vec2>): number {
  let winding = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j];
    const b = polygon[i];
    if (a === undefined || b === undefined) continue;
    const side = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
    if (a.y <= point.y && b.y > point.y && side > 0) winding += 1;
    else if (a.y > point.y && b.y <= point.y && side < 0) winding -= 1;
  }
  return winding;
}

function vectorPathsFor(obj: SceneObject): ReadonlyArray<ColoredPath> | null {
  switch (obj.kind) {
    case 'imported-svg':
    case 'shape':
    case 'text':
    case 'traced-image':
      return obj.paths;
    case 'raster-image':
    case 'relief':
      // Bounds-rect objects: selectable via the bbox hit path, no vector
      // outlines to hit-test.
      return null;
    default:
      return obj satisfies never;
  }
}

function effectiveLayerMode(obj: SceneObject, layer: Layer | undefined): LayerMode {
  return layer === undefined
    ? (obj.operationOverride?.mode ?? 'line')
    : effectiveOperationForObject(layer, obj).mode;
}

function worldPolylines(path: ColoredPath, transform: Transform): Polyline[] {
  return hitTestPolylines(path)
    .filter((polyline) => polyline.points.length > 0)
    .map((polyline) => ({
      closed: polyline.closed,
      points: polyline.points.map((point) => applyTransform(point, transform)),
    }));
}

function pointNearPolyline(point: Vec2, points: ReadonlyArray<Vec2>, closed: boolean): boolean {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (
      a !== undefined &&
      b !== undefined &&
      pointToSegmentDistance(point, a, b) <= VECTOR_STROKE_HIT_TOLERANCE_MM
    ) {
      return true;
    }
  }
  const first = points[0];
  const last = points[points.length - 1];
  return (
    closed &&
    first !== undefined &&
    last !== undefined &&
    pointToSegmentDistance(point, last, first) <= VECTOR_STROKE_HIT_TOLERANCE_MM
  );
}

function pointToSegmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  const closest = { x: a.x + t * dx, y: a.y + t * dy };
  return Math.hypot(point.x - closest.x, point.y - closest.y);
}

function pointInPolygon(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    const crossesY = a.y > point.y !== b.y > point.y;
    if (!crossesY) continue;
    const xAtY = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}

function pointInTransformedObjectBounds(point: Vec2, obj: SceneObject): boolean {
  const polygon = boundsCorners(obj.bounds).map((corner) => applyTransform(corner, obj.transform));
  if (pointInPolygon(point, polygon)) return true;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (
      start !== undefined &&
      end !== undefined &&
      pointToSegmentDistance(point, start, end) <= BOUNDS_EDGE_EPSILON_MM
    ) {
      return true;
    }
  }
  return false;
}

function pointInExpandedObjectBBox(point: Vec2, obj: SceneObject, paddingMm: number): boolean {
  const bbox = transformedBBox(obj);
  return (
    point.x >= bbox.minX - paddingMm &&
    point.x <= bbox.maxX + paddingMm &&
    point.y >= bbox.minY - paddingMm &&
    point.y <= bbox.maxY + paddingMm
  );
}

export type AABB = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** The smallest world-axis box holding the object's outline (ADR-677): the
 *  box the toolbar, the selection handles, align and the bed checks measure. */
export function transformedBBox(obj: SceneObject): AABB {
  return objectGeometryExtent(obj) ?? transformedBounds(obj.bounds, obj.transform);
}

/**
 * Axis-aligned bounding box of a bounds rect under a full transform
 * (scale → mirror → rotate → translate). All four corners go through
 * applyTransform, so rotation widens the box — unlike scaling the raw
 * extents, which understates any rotated placement.
 */
export function transformedBounds(bounds: Bounds, transform: Transform): AABB {
  return aabbOfCorners(boundsCorners(bounds), transform);
}

function boundsCorners(bounds: Bounds): ReadonlyArray<Vec2> {
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
}

export function combinedBBox(objects: ReadonlyArray<SceneObject>): AABB | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const obj of objects) {
    const b = transformedBBox(obj);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
    any = true;
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

function bboxArea(bbox: AABB): number {
  return Math.max(0, bbox.maxX - bbox.minX) * Math.max(0, bbox.maxY - bbox.minY);
}

function aabbOfCorners(corners: ReadonlyArray<Vec2>, transform: Transform): AABB {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const c of corners) {
    const p = applyTransform(c, transform);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
