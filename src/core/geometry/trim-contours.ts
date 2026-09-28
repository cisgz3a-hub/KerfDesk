// The outlines Trim Shapes works on (LightBurn gap LBG-T04). Every contour of
// visible vector artwork is flattened into world millimetres once,
// with each point remembering where it lies on the exact contour (segment +
// t), so a crossing found on the chords maps straight back onto the curve.
// Objects are flattened lazily, only when the pointer or a crossing search
// comes near them.

import { endpointArc } from '../scene/curve-path';
import { CLOSURE_EPS_MM } from '../scene/polyline-closure';
import { transformedBounds } from '../scene/hit-test';
import {
  applyTransform,
  isClosedEnough,
  isRegistrationBox,
  polylineToCurveSubpath,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type PathSegment,
  type Scene,
  type Transform,
  type Vec2,
} from '../scene';
import { sceneLayerVisibilityLookup, resolveVisibleOperationForPath } from '../scene/visibility';
import { contourSegments, segmentPoint, type ContourSegments } from './trim-curve-split';
import { isVectorPathObject, type VectorSceneObject } from './vector-path-tools';

export type TrimContour = {
  readonly key: string;
  readonly objectId: string;
  readonly pathIndex: number;
  readonly polylineIndex: number;
  readonly closed: boolean;
  /** False when the path's curves and polylines do not pair up, so it can cut but not be cut. */
  readonly trimmable: boolean;
  readonly segments: ContourSegments;
  readonly transform: Transform;
  /** World points of the chords, and each point's position on the exact contour. */
  readonly points: ReadonlyArray<Vec2>;
  readonly params: ReadonlyArray<number>;
  readonly bounds: Bounds;
};

export type TrimObjectEntry = {
  readonly object: VectorSceneObject;
  readonly bounds: Bounds;
};

export type TrimModel = {
  readonly scene: Scene;
  /** Trim-eligible objects, top-most first. */
  readonly entries: ReadonlyArray<TrimObjectEntry>;
  readonly contoursOf: (entry: TrimObjectEntry) => ReadonlyArray<TrimContour>;
};

/** World chord tolerance. Finer than any laser spot, coarse enough to hover fast. */
export const TRIM_CHORD_TOLERANCE_MM = 0.02;
const MAX_CHORDS_PER_SEGMENT = 2048;
const DUPLICATE_POINT_MM = 1e-9;
const ENTRY_MARGIN_MM = 0.5;

export function createTrimModel(scene: Scene): TrimModel {
  const lookup = sceneLayerVisibilityLookup(scene.layers);
  const entries: TrimObjectEntry[] = [];
  for (let index = scene.objects.length - 1; index >= 0; index -= 1) {
    const object = scene.objects[index];
    // Locked artwork still acts as a cutting edge; it is never cut itself.
    if (object === undefined || !isTrimEdgeArtwork(object)) continue;
    const local = localPolylineBounds(object.paths);
    if (local === null) continue;
    entries.push({ object, bounds: expand(transformedBounds(local, object.transform)) });
  }
  const cache = new Map<string, ReadonlyArray<TrimContour>>();
  return {
    scene,
    entries,
    contoursOf: (entry) => {
      const cached = cache.get(entry.object.id);
      if (cached !== undefined) return cached;
      const contours = objectContours(entry.object, lookup);
      cache.set(entry.object.id, contours);
      return contours;
    },
  };
}

/** Vector artwork other than a registration box: what other outlines are trimmed back to. */
function isTrimEdgeArtwork(object: Scene['objects'][number]): object is VectorSceneObject {
  return isVectorPathObject(object) && !isRegistrationBox(object);
}

/** Unlocked vector artwork other than a registration box. */
export function isUnlockedVectorArtwork(
  object: Scene['objects'][number],
): object is VectorSceneObject {
  return isVectorPathObject(object) && object.locked !== true && !isRegistrationBox(object);
}

function objectContours(
  object: VectorSceneObject,
  lookup: ReturnType<typeof sceneLayerVisibilityLookup>,
): ReadonlyArray<TrimContour> {
  const contours: TrimContour[] = [];
  object.paths.forEach((path, pathIndex) => {
    if (!resolveVisibleOperationForPath(object, path, lookup).visible) return;
    path.polylines.forEach((_polyline, polylineIndex) => {
      const source = contourSource(path, polylineIndex);
      if (source === null) return;
      const flattened = flattenContour(source.segments, object.transform);
      if (flattened.points.length < 2) return;
      contours.push({
        key: `${object.id}:${pathIndex}:${polylineIndex}`,
        objectId: object.id,
        pathIndex,
        polylineIndex,
        closed: source.segments.closed,
        trimmable: source.trimmable && object.locked !== true,
        segments: source.segments,
        transform: object.transform,
        ...flattened,
      });
    });
  });
  return contours;
}

export type TrimContourSource = {
  readonly segments: ContourSegments;
  readonly trimmable: boolean;
  /** True when the path stores canonical curves beside its polylines. */
  readonly curved: boolean;
};

/** The canonical geometry of one contour: its curve when curves pair with polylines, else its polyline. */
export function contourSource(path: ColoredPath, polylineIndex: number): TrimContourSource | null {
  const polyline = path.polylines[polylineIndex];
  if (polyline === undefined || polyline.points.length < 2) return null;
  const paired = path.curves !== undefined && path.curves.length === path.polylines.length;
  const curve = paired ? path.curves?.[polylineIndex] : undefined;
  if (curve !== undefined) {
    if (curve.segments.length === 0) return null;
    return {
      segments: contourSegments(curve, curve.closed || curveEndsMeet(curve)),
      trimmable: true,
      curved: true,
    };
  }
  return {
    segments: contourSegments(polylineToCurveSubpath(polyline), isClosedEnough(polyline)),
    trimmable: path.curves === undefined,
    curved: false,
  };
}

// A curve left open whose ends meet is drawn closed, like isClosedEnough's polylines.
function curveEndsMeet(curve: CurveSubpath): boolean {
  const end = curve.segments.at(-1)?.to;
  return (
    end !== undefined &&
    curve.segments.length > 1 &&
    Math.abs(end.x - curve.start.x) < CLOSURE_EPS_MM &&
    Math.abs(end.y - curve.start.y) < CLOSURE_EPS_MM
  );
}

/** World chords of a contour, each point tagged with its position (segment + t). */
export function flattenContour(
  contour: ContourSegments,
  transform: Transform,
): Pick<TrimContour, 'points' | 'params' | 'bounds'> {
  const scale = Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleY));
  const tolerance = scale > 0 && Number.isFinite(scale) ? TRIM_CHORD_TOLERANCE_MM / scale : 1;
  const points: Vec2[] = [applyTransform(contour.start, transform)];
  const params: number[] = [0];
  let from = contour.start;
  contour.segments.forEach((segment, index) => {
    for (const t of segmentSamples(from, segment, tolerance)) {
      const point = applyTransform(segmentPoint(from, segment, t), transform);
      const last = points[points.length - 1] as Vec2;
      if (Math.hypot(point.x - last.x, point.y - last.y) <= DUPLICATE_POINT_MM) {
        params[params.length - 1] = index + t;
        continue;
      }
      points.push(point);
      params.push(index + t);
    }
    from = segment.to;
  });
  return { points, params, bounds: boundsOf(points) };
}

/** Parameters of the chord ends on one segment, ending at 1. */
function segmentSamples(from: Vec2, segment: PathSegment, tolerance: number): number[] {
  const count = Math.min(MAX_CHORDS_PER_SEGMENT, Math.max(1, chordCount(from, segment, tolerance)));
  return Array.from({ length: count }, (_, index) => (index + 1) / count);
}

function chordCount(from: Vec2, segment: PathSegment, tolerance: number): number {
  if (segment.kind === 'line') return 1;
  if (segment.kind === 'cubic') {
    // Uniform steps keep the chord error under h^2/8 * max|B''| <= 0.75 M / n^2.
    const bend = Math.max(
      Math.hypot(
        from.x - 2 * segment.control1.x + segment.control2.x,
        from.y - 2 * segment.control1.y + segment.control2.y,
      ),
      Math.hypot(
        segment.control1.x - 2 * segment.control2.x + segment.to.x,
        segment.control1.y - 2 * segment.control2.y + segment.to.y,
      ),
    );
    return Math.ceil(Math.sqrt((0.75 * bend) / tolerance));
  }
  const arc = endpointArc(from, segment);
  if (arc === null) return 1;
  const radius = Math.max(arc.radiusX, arc.radiusY);
  return Math.ceil(Math.abs(arc.delta) * Math.sqrt(radius / (8 * tolerance)));
}

function localPolylineBounds(paths: ReadonlyArray<ColoredPath>): Bounds | null {
  const points = paths.flatMap((path) => path.polylines.flatMap((polyline) => polyline.points));
  return points.length === 0 ? null : boundsOf(points);
}

export function boundsOf(points: ReadonlyArray<Vec2>): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function expand(bounds: Bounds): Bounds {
  return {
    minX: bounds.minX - ENTRY_MARGIN_MM,
    minY: bounds.minY - ENTRY_MARGIN_MM,
    maxX: bounds.maxX + ENTRY_MARGIN_MM,
    maxY: bounds.maxY + ENTRY_MARGIN_MM,
  };
}

export function boundsOverlap(a: Bounds, b: Bounds, margin = 0): boolean {
  return (
    a.minX - margin <= b.maxX &&
    b.minX - margin <= a.maxX &&
    a.minY - margin <= b.maxY &&
    b.minY - margin <= a.maxY
  );
}
