import {
  applyTransform,
  type ColoredPath,
  type CurveSubpath,
  type PathSegment,
  type Scene,
  type Transform,
  type Vec2,
} from '../scene';
import { ellipticalArcEndDirection } from '../scene/curve-path';
import { isBooleanCompoundObject } from '../scene/boolean-compound';
import { CLOSURE_EPS_MM } from '../scene/polyline-closure';
import {
  boundsOverlap,
  contourSource,
  createTrimModel,
  type TrimContour,
  type TrimModel,
} from './trim-contours';
import { segmentStart } from './trim-curve-split';
import { EXTEND_EPS_MM, segmentRayContacts, type RayContact } from './extend-ray';
import type { VectorSceneObject } from './vector-path-tools';

export type ExtendStatus =
  | 'ready'
  | 'no-boundary'
  | 'already-touching'
  | 'overlap'
  | 'curved-end'
  | 'degenerate';
export type ExtendTarget = {
  readonly contour: TrimContour;
  readonly end: 'start' | 'end';
  readonly from: Vec2;
  readonly to: Vec2 | null;
  readonly status: ExtendStatus;
  readonly distanceMm: number;
};
export type ExtendModel = {
  readonly model: TrimModel;
  readonly targetAt: (contour: TrimContour, end: 'start' | 'end') => ExtendTarget;
};

/** Cache boundary queries by endpoint while the immutable scene stays unchanged. */
export function createExtendModel(scene: Scene): ExtendModel {
  const model = createTrimModel(scene);
  const cache = new Map<string, ExtendTarget>();
  return {
    model,
    targetAt: (contour, end) => {
      const key = `${contour.key}:${end}`;
      const previous = cache.get(key);
      if (previous !== undefined) return previous;
      const target = resolveTarget(model, contour, end);
      cache.set(key, target);
      return target;
    },
  };
}

/** Pick only an open endpoint; nearest wins, then top-most artwork. */
export function findExtendTarget(
  sceneOrModel: Scene | ExtendModel,
  point: Vec2,
  toleranceMm: number,
): ExtendTarget | null {
  if (!Number.isFinite(toleranceMm) || toleranceMm < 0 || !finitePoint(point)) return null;
  const session = 'model' in sceneOrModel ? sceneOrModel : createExtendModel(sceneOrModel);
  let nearest: EndpointPick | null = null;
  const probe = { minX: point.x, maxX: point.x, minY: point.y, maxY: point.y };
  for (const entry of session.model.entries) {
    if (entry.object.locked === true || isBooleanCompoundObject(entry.object)) continue;
    if (!boundsOverlap(entry.bounds, probe, toleranceMm)) continue;
    for (const contour of session.model.contoursOf(entry)) {
      nearest = pickEndpoint(contour, point, toleranceMm, nearest);
    }
  }
  return nearest === null ? null : session.targetAt(nearest.contour, nearest.end);
}

type EndpointPick = { contour: TrimContour; end: 'start' | 'end'; distance: number };
function pickEndpoint(
  contour: TrimContour,
  point: Vec2,
  tolerance: number,
  previous: EndpointPick | null,
): EndpointPick | null {
  if (contour.closed || !contour.trimmable) return previous;
  const localStart = contour.segments.start;
  const localEnd = contour.segments.segments.at(-1)?.to ?? localStart;
  // Match the shared closure policy in local coordinates, including unflagged
  // single-cubic loops. Scaling must not turn a filled loop into an open source.
  if (
    Math.abs(localStart.x - localEnd.x) < CLOSURE_EPS_MM &&
    Math.abs(localStart.y - localEnd.y) < CLOSURE_EPS_MM
  )
    return previous;
  const first = endpoint(contour, 'start');
  const last = endpoint(contour, 'end');
  if (Math.hypot(first.x - last.x, first.y - last.y) <= EXTEND_EPS_MM) return previous;
  let nearest = previous;
  for (const end of ['start', 'end'] as const) {
    const at = endpoint(contour, end);
    const distance = Math.hypot(at.x - point.x, at.y - point.y);
    if (distance > tolerance || (nearest !== null && distance >= nearest.distance - 1e-9)) continue;
    nearest = { contour, end, distance };
  }
  return nearest;
}

function endpoint(contour: TrimContour, end: 'start' | 'end'): Vec2 {
  return applyTransform(
    end === 'start'
      ? contour.segments.start
      : (contour.segments.segments.at(-1)?.to ?? contour.segments.start),
    contour.transform,
  );
}

function resolveTarget(model: TrimModel, contour: TrimContour, end: 'start' | 'end'): ExtendTarget {
  const from = endpoint(contour, end);
  const base = { contour, end, from, to: null, distanceMm: 0 };
  const index = end === 'start' ? 0 : contour.segments.segments.length - 1;
  const segment = contour.segments.segments[index];
  if (segment === undefined || !finitePoint(from) || localPoint(from, contour.transform) === null)
    return { ...base, status: 'degenerate' };
  const localInside = inwardPoint(segmentStart(contour.segments, index), segment, end);
  if (localInside === null) return { ...base, status: 'degenerate' };
  const inside = applyTransform(localInside, contour.transform);
  const length = Math.hypot(from.x - inside.x, from.y - inside.y);
  if (!Number.isFinite(length) || length <= EXTEND_EPS_MM) return { ...base, status: 'degenerate' };
  const direction = { x: (from.x - inside.x) / length, y: (from.y - inside.y) / length };
  const hit = firstContact(model, contour, from, direction);
  if (hit === null) return { ...base, status: 'no-boundary' };
  if (hit.distance <= EXTEND_EPS_MM) return { ...base, status: 'already-touching' };
  if (hit.overlap) return { ...base, status: 'overlap' };
  const to = { x: from.x + direction.x * hit.distance, y: from.y + direction.y * hit.distance };
  return { ...base, to, distanceMm: hit.distance, status: 'ready' };
}

/** A point along the inward endpoint tangent; outward extension is its negative. */
function inwardPoint(from: Vec2, segment: PathSegment, end: 'start' | 'end'): Vec2 | null {
  if (segment.kind === 'line') return end === 'start' ? segment.to : from;
  const at = end === 'start' ? from : segment.to;
  if (segment.kind === 'elliptical-arc') {
    const inward = ellipticalArcEndDirection(from, segment, end);
    return inward === null ? null : { x: at.x + inward.x, y: at.y + inward.y };
  }
  // Collapsed endpoint handles use the first nonzero higher-order derivative.
  const candidates =
    end === 'start'
      ? [segment.control1, segment.control2, segment.to]
      : [segment.control2, segment.control1, from];
  // A tiny local handle may be substantial after scaling. Only an exactly
  // collapsed handle permits moving on to the higher-order derivative.
  return candidates.find((p) => p.x !== at.x || p.y !== at.y) ?? null;
}

function firstContact(
  model: TrimModel,
  source: TrimContour,
  origin: Vec2,
  direction: Vec2,
): RayContact | null {
  let nearest: RayContact | null = null;
  for (const entry of model.entries) {
    for (const contour of model.contoursOf(entry)) {
      if (contour.key === source.key) continue;
      let from = contour.segments.start;
      for (const segment of contour.segments.segments) {
        const hits = segmentRayContacts(origin, direction, from, segment, contour.transform);
        for (const hit of hits) {
          if (
            nearest === null ||
            hit.distance < nearest.distance - EXTEND_EPS_MM ||
            (Math.abs(hit.distance - nearest.distance) <= EXTEND_EPS_MM && hit.overlap)
          )
            nearest = hit;
        }
        from = segment.to;
      }
    }
  }
  return nearest;
}

/** Move a line's endpoint or append a straight tangent; existing curves stay intact. */
export function extendEdit(
  object: VectorSceneObject,
  target: ExtendTarget,
): ReadonlyArray<ColoredPath> | null {
  if (
    target.status !== 'ready' ||
    target.to === null ||
    object.id !== target.contour.objectId ||
    object.locked === true
  )
    return null;
  const { pathIndex, polylineIndex } = target.contour;
  const path = object.paths[pathIndex];
  if (path === undefined) return null;
  const source = contourSource(path, polylineIndex);
  const point = localPoint(target.to, object.transform);
  if (source === null || source.segments.closed || !source.trimmable || point === null) return null;
  if (!matchesEndpoint(object, source, target)) return null;
  const replacement = replaceEndpoint(path, target, point);
  return object.paths.map((p, i) => (i === pathIndex ? replacement : p));
}

function matchesEndpoint(
  object: VectorSceneObject,
  source: NonNullable<ReturnType<typeof contourSource>>,
  target: ExtendTarget,
): boolean {
  const placementKeys = [
    'x',
    'y',
    'scaleX',
    'scaleY',
    'rotationDeg',
    'mirrorX',
    'mirrorY',
  ] as const;
  if (placementKeys.some((key) => object.transform[key] !== target.contour.transform[key]))
    return false;
  const index = target.end === 'start' ? 0 : source.segments.segments.length - 1;
  const segment = source.segments.segments[index];
  if (segment === undefined) return false;
  const old = target.contour.segments;
  const oldIndex = target.end === 'start' ? 0 : old.segments.length - 1;
  const oldSegment = old.segments[oldIndex];
  if (oldSegment === undefined) return false;
  if (JSON.stringify(segment) !== JSON.stringify(oldSegment)) return false;
  const inside = applyTransform(
    target.end === 'start' ? segment.to : segmentStart(source.segments, index),
    object.transform,
  );
  const oldInside = applyTransform(
    target.end === 'start' ? oldSegment.to : segmentStart(old, oldIndex),
    target.contour.transform,
  );
  if (Math.hypot(inside.x - oldInside.x, inside.y - oldInside.y) > EXTEND_EPS_MM) return false;
  // A preview from an older object must never apply to newly edited geometry.
  const current = applyTransform(
    target.end === 'start' ? source.segments.start : segment.to,
    object.transform,
  );
  return Math.hypot(current.x - target.from.x, current.y - target.from.y) <= EXTEND_EPS_MM;
}

function replaceEndpoint(path: ColoredPath, target: ExtendTarget, point: Vec2): ColoredPath {
  const { polylineIndex } = target.contour;
  const polyline = path.polylines[polylineIndex];
  if (polyline === undefined) return path;
  const pointIndex = target.end === 'start' ? 0 : polyline.points.length - 1;
  const terminal =
    target.end === 'start'
      ? target.contour.segments.segments[0]
      : target.contour.segments.segments.at(-1);
  if (terminal !== undefined && terminal.kind !== 'line') return appendTangent(path, target, point);
  const polylines = path.polylines.map((p, i) =>
    i === polylineIndex
      ? { ...p, points: p.points.map((old, j) => (j === pointIndex ? point : old)) }
      : p,
  );
  const curves = path.curves?.map((curve, i) => {
    if (i !== polylineIndex) return curve;
    return target.end === 'start'
      ? { ...curve, start: point }
      : {
          ...curve,
          segments: curve.segments.map((segment, j) =>
            j === curve.segments.length - 1 ? { ...segment, to: point } : segment,
          ),
        };
  });
  return { ...path, polylines, ...(curves === undefined ? {} : { curves }) };
}

function appendTangent(path: ColoredPath, target: ExtendTarget, point: Vec2): ColoredPath {
  const index = target.contour.polylineIndex;
  const start = target.end === 'start';
  const polylines = path.polylines.map((p, i) =>
    i === index ? { ...p, points: start ? [point, ...p.points] : [...p.points, point] } : p,
  );
  const curves = path.curves?.map((curve, i): CurveSubpath => {
    if (i !== index) return curve;
    return start
      ? { ...curve, start: point, segments: [{ kind: 'line', to: curve.start }, ...curve.segments] }
      : { ...curve, segments: [...curve.segments, { kind: 'line', to: point }] };
  });
  return { ...path, polylines, ...(curves === undefined ? {} : { curves }) };
}

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
function localPoint(point: Vec2, transform: Transform): Vec2 | null {
  const sx = transform.scaleX * (transform.mirrorX ? -1 : 1);
  const sy = transform.scaleY * (transform.mirrorY ? -1 : 1);
  if (sx === 0 || sy === 0 || !Number.isFinite(sx) || !Number.isFinite(sy)) return null;
  const radians = (transform.rotationDeg * Math.PI) / 180;
  const x = point.x - transform.x;
  const y = point.y - transform.y;
  const local = {
    x: (x * Math.cos(radians) + y * Math.sin(radians)) / sx,
    y: (-x * Math.sin(radians) + y * Math.cos(radians)) / sy,
  };
  return finitePoint(local) ? local : null;
}
