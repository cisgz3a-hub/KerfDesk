// hitTest - given a point in scene-logical coordinates (mm), find the topmost
// SceneObject at that point. Pure: no DOM, no rendering. Used by the UI when
// the user clicks the canvas.
//
// Vector artwork is tested against its actual polylines so large outline
// shapes do not behave like invisible filled slabs over smaller nested shapes.

import type { Layer, LayerMode } from './layer';
import type { Scene } from './scene';
import type { ColoredPath, Polyline, SceneObject, Transform, Vec2 } from './scene-object';
import { applyTransform } from './transform';
import { sceneObjectHasVisibleLayerFromMap } from './visibility';

const VECTOR_STROKE_HIT_TOLERANCE_MM = 2;

type ObjectHit =
  | { readonly kind: 'none' }
  | { readonly kind: 'primary' }
  | { readonly kind: 'line-interior'; readonly area: number };

const NO_HIT: ObjectHit = { kind: 'none' };

export function hitTest(scene: Scene, point: Vec2): string | null {
  const layerByColor = new Map(scene.layers.map((layer) => [layer.color, layer]));
  let bestLineInterior: { readonly id: string; readonly area: number } | null = null;

  // Topmost first: later-added objects render on top so direct hits win first.
  for (let i = scene.objects.length - 1; i >= 0; i -= 1) {
    const obj = scene.objects[i];
    if (obj === undefined) continue;
    if (obj.locked === true) continue;
    if (!sceneObjectHasVisibleLayerFromMap(obj, layerByColor)) continue;

    const hit = hitObject(layerByColor, obj, point);
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

function hitObject(
  layerByColor: ReadonlyMap<string, Layer>,
  obj: SceneObject,
  point: Vec2,
): ObjectHit {
  const paths = vectorPathsFor(obj);
  if (paths === null) return pointInObjectBBox(point, obj) ? { kind: 'primary' } : NO_HIT;
  if (!pointInExpandedObjectBBox(point, obj, VECTOR_STROKE_HIT_TOLERANCE_MM)) return NO_HIT;
  return hitVectorObject(layerByColor, obj, paths, point);
}

function hitVectorObject(
  layerByColor: ReadonlyMap<string, Layer>,
  obj: SceneObject,
  paths: ReadonlyArray<ColoredPath>,
  point: Vec2,
): ObjectHit {
  let hasPolyline = false;
  let lineInteriorArea: number | null = null;
  for (const path of paths) {
    const layer = layerByColor.get(path.color);
    if (layer?.visible === false) continue;
    const mode = effectiveLayerMode(obj, layer);
    for (const polyline of path.polylines) {
      if (polyline.points.length === 0) continue;
      hasPolyline = true;
      const hit = hitPolyline(obj, mode, polyline, point);
      if (hit.kind === 'primary') return hit;
      if (hit.kind === 'line-interior') {
        lineInteriorArea =
          lineInteriorArea === null ? hit.area : Math.min(lineInteriorArea, hit.area);
      }
    }
  }
  if (!hasPolyline && pointInObjectBBox(point, obj)) return { kind: 'primary' };
  return lineInteriorArea === null ? NO_HIT : { kind: 'line-interior', area: lineInteriorArea };
}

function hitPolyline(
  obj: SceneObject,
  mode: LayerMode,
  polyline: Polyline,
  point: Vec2,
): ObjectHit {
  const transformed = transformedPolyline(polyline, obj.transform);
  if (pointNearPolyline(point, transformed.points, transformed.closed)) return { kind: 'primary' };
  if (!transformed.closed || !pointInPolygon(point, transformed.points)) return NO_HIT;
  if (mode === 'fill' || mode === 'image') return { kind: 'primary' };
  return { kind: 'line-interior', area: bboxArea(transformedBBox(obj)) };
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
  return obj.operationOverride?.mode ?? layer?.mode ?? 'line';
}

function transformedPolyline(polyline: Polyline, transform: Transform): Polyline {
  return {
    closed: polyline.closed,
    points: polyline.points.map((point) => applyTransform(point, transform)),
  };
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

function pointInObjectBBox(point: Vec2, obj: SceneObject): boolean {
  return pointInExpandedObjectBBox(point, obj, 0);
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

export function transformedBBox(obj: SceneObject): AABB {
  const corners: Vec2[] = [
    { x: obj.bounds.minX, y: obj.bounds.minY },
    { x: obj.bounds.maxX, y: obj.bounds.minY },
    { x: obj.bounds.maxX, y: obj.bounds.maxY },
    { x: obj.bounds.minX, y: obj.bounds.maxY },
  ];
  return aabbOfCorners(corners, obj.transform);
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
