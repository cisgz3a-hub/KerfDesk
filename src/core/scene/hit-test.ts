// hitTest - given a point in scene-logical coordinates (mm), find the topmost
// SceneObject at that point. Pure: no DOM, no rendering. Used by the UI when
// the user clicks the canvas.
//
// Vector artwork is tested against its actual polylines so large outline
// shapes do not behave like invisible filled slabs over smaller nested shapes.

import type { Layer, LayerMode } from './layer';
import { effectiveOperationForObject } from './effective-operation';
import {
  fillPoolKey,
  fillPoolRuns,
  pathFillOperations,
  pathStylingOperation,
  type FillPoolRuns,
  type PathFillOperation,
} from './fill-operations';
import { isRegistrationBox } from './registration-layer';
import type { Scene } from './scene';
import type { Bounds, ColoredPath, Polyline, SceneObject, Transform, Vec2 } from './scene-object';
import { applyTransform } from './transform';
import { objectGeometryExtent } from './object-extent';
import {
  resolveVisibleOperationForPath,
  sceneLayerVisibilityLookup,
  sceneObjectHasVisibleLayerFromMap,
} from './visibility';
import { pointInPolygon } from '../geometry/point-in-polygon';
import { boxCorners } from '../geometry/box-math';
import {
  DEFAULT_STROKE_HIT_TOLERANCE_MM,
  distanceToPolyline,
  hitTestPolylines,
  pointToSegmentDistance,
  strokeReachMm,
} from './hit-test-polylines';

export { DEFAULT_STROKE_HIT_TOLERANCE_MM };

const BOUNDS_EDGE_EPSILON_MM = 1e-9;
// Two lines this close to equally near are a tie, which stacking order settles.
const NEAREST_TIE_MM = 1e-9;

/**
 * A primary hit is on the object itself. `covers` says it is painted over the
 * point (a filled area, an image); otherwise the point is within reach of one
 * of its lines, `distanceMm` away.
 */
export type HitTestObjectResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'primary'; readonly distanceMm: number; readonly covers: boolean }
  | { readonly kind: 'line-interior'; readonly area: number };

const NO_HIT: HitTestObjectResult = { kind: 'none' };
const COVERED: HitTestObjectResult = { kind: 'primary', distanceMm: 0, covers: true };

export type HitTestOptions = {
  readonly includeLocked?: boolean;
  readonly wireframe?: boolean;
  /**
   * How far from a line a click still picks it, in scene millimetres. The
   * workspace passes a screen distance at the live zoom (ADR-196 Amendment 1);
   * a caller with no view gets 2 mm.
   */
  readonly strokeToleranceMm?: number;
};

/** `direct`: on a line or a painted area. `interior`: inside an outline not filled there. */
export type SceneHit = { readonly id: string; readonly kind: 'direct' | 'interior' };

/**
 * Selection skips locked artwork. `includeLocked` is for display-only uses
 * (the hover colour pulse, ADR-620) where the piece under the pointer is the
 * answer even if it cannot be picked. `wireframe` is the Wireframe view, which
 * outlines Fill artwork (ADR-410), so its interiors are not solid to a click.
 */
export function hitTest(scene: Scene, point: Vec2, options: HitTestOptions = {}): string | null {
  return hitTestDetailed(scene, point, options)?.id ?? null;
}

/**
 * The object a click picks and how it was hit (ADR-196 Amendment 1). Of the
 * lines within reach the nearest wins, and stacking order settles a tie. An
 * object painted over the point hides everything beneath it, and gives way
 * only to a line drawn above it. With no such hit, the smallest outline
 * around the point is picked by its interior.
 */
export function hitTestDetailed(
  scene: Scene,
  point: Vec2,
  options: HitTestOptions = {},
): SceneHit | null {
  const reachMm = strokeReachMm(options.strokeToleranceMm);
  const layerByColor = sceneLayerVisibilityLookup(scene.layers);
  const pools =
    options.wireframe === true
      ? OUTLINES_ONLY
      : fillPoolParityAt(scene, layerByColor, point, reachMm);
  const includeLocked = options.includeLocked === true;
  let nearestLine: NearLine | null = null;
  let bestLineInterior: EnclosingOutline | null = null;

  // Topmost first: later-added objects render on top.
  for (let i = scene.objects.length - 1; i >= 0; i -= 1) {
    const obj = scene.objects[i];
    if (obj === undefined || !isHitCandidate(obj, layerByColor, includeLocked)) continue;
    const hit = hitTestObject(layerByColor, obj, point, pools, reachMm);
    if (hit.kind === 'primary') {
      if (hit.covers) return { id: nearestLine?.id ?? obj.id, kind: 'direct' };
      nearestLine = nearerLine(nearestLine, { id: obj.id, distanceMm: hit.distanceMm });
    } else if (hit.kind === 'line-interior') {
      bestLineInterior = smallerOutline(bestLineInterior, { id: obj.id, area: hit.area });
    }
  }
  return lineOrInterior(nearestLine, bestLineInterior);
}

// A line in reach is on the object itself and beats any outline around the point.
function lineOrInterior(line: NearLine | null, outline: EnclosingOutline | null): SceneHit | null {
  if (line !== null) return { id: line.id, kind: 'direct' };
  return outline === null ? null : { id: outline.id, kind: 'interior' };
}

type NearLine = { readonly id: string; readonly distanceMm: number };
type EnclosingOutline = { readonly id: string; readonly area: number };

// `best` was met first, so it is stacked above `next` and keeps a tie.
function nearerLine(best: NearLine | null, next: NearLine): NearLine {
  return best === null || next.distanceMm < best.distanceMm - NEAREST_TIE_MM ? next : best;
}

function smallerOutline(best: EnclosingOutline | null, next: EnclosingOutline): EnclosingOutline {
  return best === null || next.area < best.area ? next : best;
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
  strokeToleranceMm?: number,
): HitTestObjectResult {
  const paths = vectorPathsFor(obj);
  if (paths === null) {
    return pointInTransformedObjectBounds(point, obj) ? COVERED : NO_HIT;
  }
  const reachMm = strokeReachMm(strokeToleranceMm);
  if (!pointInExpandedObjectBBox(point, obj, reachMm)) return NO_HIT;
  // The canvas paints a jig box by itself, never in a pool (fill-pools.ts).
  const pooled = pools !== OUTLINES_ONLY && isRegistrationBox(obj) ? undefined : pools;
  return hitVectorObject(layerByColor, obj, paths, { point, reachMm }, pooled);
}

/** Whether this object's Fill pool covers the point an odd number of times, so the canvas paints it there. */
export type FillPoolParity = (object: SceneObject, fill: PathFillOperation) => boolean;

/** The Wireframe view: no pool is painted anywhere. */
export const OUTLINES_ONLY: FillPoolParity = () => false;

/**
 * A point that an even number of a Fill operation's objects cover is drawn
 * and burned empty (ADR-683), whichever object made the hole. Each pool is
 * counted once, when a filled path under the point first asks: every object
 * of it covering the point (its paths unioned, each by its own rule, as the
 * compiler burns one object) flips the parity. A pool stays inside its compile
 * run (fill-operations.ts), so a jig copy never makes a hole in ordinary artwork.
 */
export function fillPoolParityAt(
  scene: Scene,
  layerByColor: ReadonlyMap<string, Layer>,
  point: Vec2,
  strokeToleranceMm?: number,
): FillPoolParity {
  const reachMm = strokeReachMm(strokeToleranceMm);
  const parity = new Map<string, boolean>();
  let runs: FillPoolRuns | undefined;
  return (object, fill) => {
    runs ??= fillPoolRuns(scene);
    const runOf = runs;
    const key = fillPoolKey(fill, runOf(object));
    let odd = parity.get(key);
    if (odd === undefined) {
      const covering = scene.objects.filter((candidate) =>
        coversInPool(layerByColor, candidate, { key, runOf }, { point, reachMm }),
      );
      odd = covering.length % 2 === 1;
      parity.set(key, odd);
    }
    return odd;
  };
}

// The point a click is tested at, and its reach to a line.
type Probe = { readonly point: Vec2; readonly reachMm: number };

function coversInPool(
  layerByColor: ReadonlyMap<string, Layer>,
  object: SceneObject,
  pool: { readonly key: string; readonly runOf: FillPoolRuns },
  probe: Probe,
): boolean {
  const paths = vectorPathsFor(object);
  if (paths === null || isRegistrationBox(object)) return false;
  if (!pointInExpandedObjectBBox(probe.point, object, probe.reachMm)) return false;
  // Winding in object space: a dense pool asks every member on each hover.
  const local = objectSpacePoint(probe.point, object.transform);
  if (local === null) return false;
  return paths.some(
    (path) =>
      pathFillOperations(object, path, layerByColor).some(
        (fill) => fillPoolKey(fill, pool.runOf(object)) === pool.key,
      ) &&
      pointInFilledPath(
        object,
        path,
        hitTestPolylines(path, object.transform, probe.reachMm),
        local,
      ),
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
  probe: Probe,
  pools: FillPoolParity | undefined,
): HitTestObjectResult {
  let hasPolyline = false;
  let lineInteriorArea: number | null = null;
  let nearestLineMm: number | null = null;
  for (const path of paths) {
    if (!resolveVisibleOperationForPath(obj, path, layerByColor).visible) continue;
    const polylines = worldPolylines(path, obj.transform, probe.reachMm);
    if (polylines.length === 0) continue;
    hasPolyline = true;
    const solid = (): boolean => {
      const fills = pathFillOperations(obj, path, layerByColor);
      if (fills.length > 0) return pools === undefined || fills.some((fill) => pools(obj, fill));
      // A path no Fill operation owns has no pool, and stands alone.
      const mode = effectiveLayerMode(obj, pathStylingOperation(obj, path, layerByColor));
      return mode === 'fill' || mode === 'image';
    };
    const hit = hitPath(obj, path, polylines, probe, solid);
    if (hit.kind === 'primary') {
      if (hit.covers) return hit;
      nearestLineMm =
        nearestLineMm === null ? hit.distanceMm : Math.min(nearestLineMm, hit.distanceMm);
    } else if (hit.kind === 'line-interior') {
      lineInteriorArea =
        lineInteriorArea === null ? hit.area : Math.min(lineInteriorArea, hit.area);
    }
  }
  // An empty vector has no rendered geometry. Its persisted bounds are useful
  // for diagnostics and repair, but must not turn invisible artwork into a
  // direct-hit slab over real objects underneath.
  if (!hasPolyline) return NO_HIT;
  if (nearestLineMm !== null) return { kind: 'primary', distanceMm: nearestLineMm, covers: false };
  return lineInteriorArea === null ? NO_HIT : { kind: 'line-interior', area: lineInteriorArea };
}

// A filled path is solid only where the canvas fills it: by its own rule over
// all of its closed contours together (L8-P2-5), and where its Fill pool's
// parity is odd (a window cut by another object, or stacked copies that
// cancel). A point in one of its holes, like a point inside a Line shape, is
// only an interior hit (ADR-196), so any artwork the hole shows is picked first.
function hitPath(
  obj: SceneObject,
  path: ColoredPath,
  polylines: ReadonlyArray<Polyline>,
  probe: Probe,
  solid: () => boolean,
): HitTestObjectResult {
  const { point } = probe;
  const closed = polylines.filter((polyline) => polyline.closed);
  const inside = closed.some((polyline) => pointInPolygon(point, polyline.points));
  if (inside && pointInFilledPath(obj, path, closed, point) && solid()) return COVERED;
  let distanceMm = Number.POSITIVE_INFINITY;
  for (const polyline of polylines) {
    distanceMm = Math.min(distanceMm, distanceToPolyline(point, polyline.points, polyline.closed));
  }
  if (distanceMm <= probe.reachMm) return { kind: 'primary', distanceMm, covers: false };
  if (!inside) return NO_HIT;
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

function worldPolylines(path: ColoredPath, transform: Transform, reachMm: number): Polyline[] {
  return hitTestPolylines(path, transform, reachMm)
    .filter((polyline) => polyline.points.length > 0)
    .map((polyline) => ({
      closed: polyline.closed,
      points: polyline.points.map((point) => applyTransform(point, transform)),
    }));
}

function pointInTransformedObjectBounds(point: Vec2, obj: SceneObject): boolean {
  const polygon = boxCorners(obj.bounds).map((corner) => applyTransform(corner, obj.transform));
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
  return aabbOfCorners(boxCorners(bounds), transform);
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
