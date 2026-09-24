// pen-snap-geometry — the scene geometry the pen snaps to, in scene
// millimetres (ADR-380). Built per object and cached against the object
// itself: scene objects are immutable, so an unchanged object keeps its entry
// across pointer moves and an edited one simply misses the cache. Node,
// midpoint and segment lists are built only for subpaths whose box the
// pointer actually reaches, so a dense trace costs nothing until approached.

import {
  applyTransform,
  curveSubpathBounds,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenCurveSubpath,
  polylineToCurveSubpath,
  transformedBounds,
  type AABB,
  type ColoredPath,
  type CurveSubpath,
  type PathSegment,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../../core/scene';
import type { SnapSegment } from '../../core/design/snap';

export type PenSnapSubpath = {
  readonly pathIndex: number;
  readonly curveIndex: number;
  // Object-local geometry; the details below are in scene millimetres.
  readonly curve: CurveSubpath;
  readonly box: AABB;
};

export type PenSnapDetails = {
  readonly nodes: ReadonlyArray<Vec2>;
  readonly midpoints: ReadonlyArray<Vec2>;
  readonly segments: ReadonlyArray<SnapSegment>;
};

export type PenSnapObject = {
  readonly box: AABB;
  readonly subpaths: ReadonlyArray<PenSnapSubpath>;
  // Image corners snap like nodes (LightBurn's Node snap includes them).
  readonly corners: ReadonlyArray<Vec2>;
};

const EPSILON_MM = 1e-9;
const objectCache = new WeakMap<SceneObject, PenSnapObject>();
const detailCache = new WeakMap<PenSnapSubpath, PenSnapDetails>();

export function penSnapObject(object: SceneObject): PenSnapObject {
  const cached = objectCache.get(object);
  if (cached !== undefined) return cached;
  const built = buildSnapObject(object);
  objectCache.set(object, built);
  return built;
}

export function penSnapDetails(object: SceneObject, subpath: PenSnapSubpath): PenSnapDetails {
  const cached = detailCache.get(subpath);
  if (cached !== undefined) return cached;
  const built = buildDetails(subpath, object.transform, snapEntityId(object.id, subpath));
  detailCache.set(subpath, built);
  return built;
}

export function boxReaches(box: AABB, point: Vec2, reachMm: number): boolean {
  return (
    point.x >= box.minX - reachMm &&
    point.x <= box.maxX + reachMm &&
    point.y >= box.minY - reachMm &&
    point.y <= box.maxY + reachMm
  );
}

/** A path's subpaths as curves, whether it stores curves or only polylines. */
export function pathSubpathCurves(path: ColoredPath): ReadonlyArray<CurveSubpath> {
  return path.curves ?? path.polylines.map(polylineToCurveSubpath);
}

/** Anchor points of a curve, without the closing duplicate of its start. */
export function curveAnchors(curve: CurveSubpath): ReadonlyArray<Vec2> {
  const anchors = [curve.start, ...curve.segments.map((segment) => segment.to)];
  const last = anchors[anchors.length - 1];
  if (curve.closed && anchors.length > 1 && last !== undefined && samePoint(last, curve.start)) {
    anchors.pop();
  }
  return anchors;
}

function buildSnapObject(object: SceneObject): PenSnapObject {
  if (!('paths' in object)) {
    const box = transformedBounds(object.bounds, object.transform);
    return { box, subpaths: [], corners: boundsCorners(object.bounds, object.transform) };
  }
  const subpaths: PenSnapSubpath[] = [];
  object.paths.forEach((path, pathIndex) => {
    pathSubpathCurves(path).forEach((curve, curveIndex) => {
      if (curve.segments.length === 0) return;
      const box = transformedBounds(curveSubpathBounds(curve), object.transform);
      subpaths.push({ pathIndex, curveIndex, curve, box });
    });
  });
  return { box: unionBox(subpaths.map((subpath) => subpath.box)), subpaths, corners: [] };
}

function buildDetails(
  subpath: PenSnapSubpath,
  transform: Transform,
  entityId: string,
): PenSnapDetails {
  const toScene = (point: Vec2): Vec2 => applyTransform(point, transform);
  const pieces = curvePieces(subpath.curve);
  const midpoints = pieces.map(({ from, segment }) => toScene(segmentMidpoint(from, segment)));
  const flattened = flattenCurveSubpath(subpath.curve, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  });
  const points = flattened.kind === 'ok' ? flattened.polyline.points.map(toScene) : [];
  const segments: SnapSegment[] = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const fromMm = points[index];
    const toMm = points[index + 1];
    if (fromMm !== undefined && toMm !== undefined) segments.push({ fromMm, toMm, entityId });
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (
    subpath.curve.closed &&
    first !== undefined &&
    last !== undefined &&
    !samePoint(first, last)
  ) {
    segments.push({ fromMm: last, toMm: first, entityId });
  }
  return { nodes: curveAnchors(subpath.curve).map(toScene), midpoints, segments };
}

type CurvePiece = { readonly from: Vec2; readonly segment: PathSegment };

// Every drawn segment with its start point, including the implied closing
// segment of a closed path whose last node does not repeat its start.
function curvePieces(curve: CurveSubpath): ReadonlyArray<CurvePiece> {
  const pieces: CurvePiece[] = [];
  let from = curve.start;
  for (const segment of curve.segments) {
    pieces.push({ from, segment });
    from = segment.to;
  }
  if (curve.closed && !samePoint(from, curve.start)) {
    pieces.push({ from, segment: { kind: 'line', to: curve.start } });
  }
  return pieces;
}

// Half-way along the segment's length, so a curve's midpoint sits where the
// eye expects it rather than at its parameter midpoint.
function segmentMidpoint(from: Vec2, segment: PathSegment): Vec2 {
  if (segment.kind === 'line') {
    return { x: (from.x + segment.to.x) / 2, y: (from.y + segment.to.y) / 2 };
  }
  const flattened = flattenCurveSubpath(
    { start: from, segments: [segment], closed: false },
    { toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM },
  );
  if (flattened.kind !== 'ok') return segment.to;
  return pointAtHalfLength(flattened.polyline.points);
}

function pointAtHalfLength(points: ReadonlyArray<Vec2>): Vec2 {
  const lengths = points.slice(1).map((point, index) => distance(points[index] ?? point, point));
  let remaining = lengths.reduce((total, length) => total + length, 0) / 2;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index] ?? 0;
    const from = points[index];
    const to = points[index + 1];
    if (from === undefined || to === undefined) break;
    if (remaining <= length && length > 0) {
      const t = remaining / length;
      return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    }
    remaining -= length;
  }
  return points[points.length - 1] ?? { x: 0, y: 0 };
}

function boundsCorners(bounds: SceneObject['bounds'], transform: Transform): Vec2[] {
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ].map((corner) => applyTransform(corner, transform));
}

function unionBox(boxes: ReadonlyArray<AABB>): AABB {
  let box: AABB = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const next of boxes) {
    box = {
      minX: Math.min(box.minX, next.minX),
      minY: Math.min(box.minY, next.minY),
      maxX: Math.max(box.maxX, next.maxX),
      maxY: Math.max(box.maxY, next.maxY),
    };
  }
  return box;
}

// Intersections are only offered between different entities; keying them per
// subpath keeps crossings inside one object (two strokes of an imported
// drawing) while a path's own adjacent segments never count as a crossing.
function snapEntityId(objectId: string, subpath: PenSnapSubpath): string {
  return `${objectId}:${subpath.pathIndex}:${subpath.curveIndex}`;
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= EPSILON_MM && Math.abs(a.y - b.y) <= EPSILON_MM;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
