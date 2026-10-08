import { err, ok, type Result } from '../result';
import type { ColoredPath, CurveSubpath, Polyline, SceneObject, Transform, Vec2 } from '../scene';
import { detectCandidates } from './joint-resize-detection';
import type {
  JointResizeRequest,
  JointResizeObject,
  JointCandidate,
  JointResizeAnalysis,
  Failure,
  Contour,
  Geometry,
  Extraction,
} from './joint-resize-types';
export type {
  JointResizeRequest,
  JointResizeObject,
  JointCandidate,
  JointResizeAnalysis,
} from './joint-resize-types';
import { applyTransform } from '../scene/transform';
import { boundsForPaths } from './vector-path-tools';
import { isBooleanCompoundObject } from '../scene/boolean-compound';
import {
  jointContourRelation,
  normalizeJointPoints,
  signedJointArea,
  simpleJointPolygon,
} from './joint-resize-geometry';

const POINT_LIMIT = 2000;
const CONTOUR_LIMIT = 64;
const TOTAL_POINT_LIMIT = 20_000;
const EPS = 1e-7;

export function analyseJointResize(
  objects: ReadonlyArray<SceneObject>,
  request: JointResizeRequest,
): Result<JointResizeAnalysis, Failure> {
  const validation = validateRequest(request);
  if (validation !== null) return err({ message: validation });
  const extracted = extract(objects);
  const candidates: JointCandidate[] = [];
  const notices = [...extracted.notices];
  for (const geometry of extracted.geometries) {
    const found = geometry.contours.flatMap((contour) =>
      detectCandidates(geometry, contour, request),
    );
    const unique = found.filter(
      (candidate, i) =>
        !found.some(
          (other, j) =>
            i !== j &&
            candidate.pathIndex === other.pathIndex &&
            candidate.contourIndex === other.contourIndex &&
            candidate.shifts.some((shift) =>
              other.shifts.some((otherShift) => shift.vertex === otherShift.vertex),
            ),
        ),
    );
    if (unique.length !== found.length)
      notices.push(
        `${geometry.object.id}: overlapping candidate vertices were excluded as ambiguous.`,
      );
    candidates.push(...unique);
  }
  return ok({
    candidates,
    notices,
    targetWidthMm: request.materialThicknessMm + request.fitAllowanceMm,
  });
}

export function previewJointResize(
  objects: ReadonlyArray<SceneObject>,
  request: JointResizeRequest,
  selectedIds: ReadonlyArray<string>,
): Result<
  { readonly objects: ReadonlyArray<JointResizeObject>; readonly changedFeatures: number },
  Failure
> {
  const analysis = analyseJointResize(objects, request);
  if (analysis.kind === 'error') return analysis;
  const ids = new Set(selectedIds);
  if (ids.size === 0)
    return err({ message: 'Select the receiving features you have verified in the preview.' });
  const selected = analysis.value.candidates.filter((candidate) => ids.has(candidate.id));
  if (selected.length !== ids.size)
    return err({
      message: 'The feature selection no longer matches this detection. Review it again.',
    });
  if (
    selected.every((candidate) => Math.abs(analysis.value.targetWidthMm - candidate.widthMm) <= EPS)
  )
    return err({ message: 'The selected widths already match the requested width.' });
  const extracted = extract(objects);
  const changed: JointResizeObject[] = [];
  for (const geometry of extracted.geometries) {
    const features = selected.filter((candidate) => candidate.objectId === geometry.object.id);
    if (features.length === 0) continue;
    const result = resizeGeometry(geometry, features, analysis.value.targetWidthMm);
    if (result.kind === 'error') return result;
    changed.push(result.value);
  }
  return ok({ objects: changed, changedFeatures: selected.length });
}

function validateRequest(request: JointResizeRequest): string | null {
  if (Object.values(request).some((value) => !Number.isFinite(value)))
    return 'Enter finite dimensions in millimetres.';
  if (
    request.currentWidthMm <= 0 ||
    request.materialThicknessMm <= 0 ||
    request.materialThicknessMm + request.fitAllowanceMm <= 0
  )
    return 'Current width, material thickness and resulting opening width must be positive.';
  if (
    request.detectionToleranceMm < 0 ||
    request.detectionToleranceMm >= request.currentWidthMm / 2
  )
    return 'Detection tolerance must be non-negative and less than half the current width.';
  return null;
}

function extract(objects: ReadonlyArray<SceneObject>): Extraction {
  const geometries: Geometry[] = [];
  const notices: string[] = [];
  let reviewedPoints = 0;
  for (const object of objects) {
    const reason = unsupportedReason(object);
    if (reason !== null || (object.kind !== 'imported-svg' && object.kind !== 'traced-image')) {
      notices.push(`${object.id}: ${reason ?? 'Convert editable shapes or text to paths first.'}`);
      continue;
    }
    const contours = object.paths.flatMap((path, pathIndex) =>
      straightPolylines(path).map((polyline, contourIndex) => ({
        pathIndex,
        contourIndex,
        points: normalizeJointPoints(polyline.points).map((point) =>
          applyTransform(point, object.transform),
        ),
        closed: polyline.closed,
      })),
    );
    const pointCount = contours.reduce((sum, contour) => sum + contour.points.length, 0);
    if (reviewedPoints + pointCount > TOTAL_POINT_LIMIT) {
      notices.push(
        `${object.id}: selection review is limited to ${TOTAL_POINT_LIMIT} points; review this object separately.`,
      );
      continue;
    }
    reviewedPoints += pointCount;
    const invalid = contours
      .filter((contour) => contour.closed)
      .some((contour) => !simpleJointPolygon(contour.points));
    if (invalid || !safeRelations(contours)) {
      notices.push(
        `${object.id}: touching, crossing or degenerate contours are ambiguous and were excluded.`,
      );
      continue;
    }
    geometries.push({ object, contours });
  }
  return { geometries, notices };
}

function unsupportedReason(object: SceneObject): string | null {
  if (isBooleanCompoundObject(object)) return 'Expand the compound before resizing result joints.';
  if (object.locked === true) return 'Locked artwork is excluded.';
  if (object.kind !== 'imported-svg' && object.kind !== 'traced-image')
    return 'Use imported or traced paths; convert editable shapes/text to paths first.';
  const t = object.transform;
  if (
    Object.values(t).some((value) => typeof value === 'number' && !Number.isFinite(value)) ||
    t.scaleX === 0 ||
    t.scaleY === 0
  )
    return 'Non-invertible transforms are excluded.';
  if (
    object.paths.some((path) =>
      path.curves?.some((curve) => curve.segments.some((segment) => segment.kind !== 'line')),
    )
  )
    return 'Curved artwork is excluded without flattening or changing its source.';
  const lines = object.paths.flatMap(straightPolylines);
  if (
    lines.length > CONTOUR_LIMIT ||
    lines.reduce((sum, line) => sum + line.points.length, 0) > POINT_LIMIT
  )
    return `Review is limited to ${CONTOUR_LIMIT} contours / ${POINT_LIMIT} points per object; split this artwork first.`;
  if (lines.some((line) => !line.closed))
    return 'Open paths are excluded; receiving slots must have a closed boundary.';
  return null;
}

function straightPolylines(path: ColoredPath): ReadonlyArray<Polyline> {
  if (path.curves === undefined) return path.polylines;
  return path.curves.map((curve) => ({
    closed: curve.closed,
    points: [curve.start, ...curve.segments.map((segment) => segment.to)],
  }));
}

function safeRelations(contours: ReadonlyArray<Contour>): boolean {
  return contours.every((contour, i) =>
    contours.every(
      (other, j) => j <= i || jointContourRelation(contour.points, other.points) !== 'intersect',
    ),
  );
}

function resizeGeometry(
  geometry: Geometry,
  features: ReadonlyArray<JointCandidate>,
  target: number,
): Result<JointResizeObject, Failure> {
  const updated = geometry.contours.map((contour) => {
    const matching = features.filter(
      (feature) =>
        feature.pathIndex === contour.pathIndex && feature.contourIndex === contour.contourIndex,
    );
    const points = contour.points.map((point, index) =>
      matching.reduce((current, feature) => {
        const shift = feature.shifts.find((item) => item.vertex === index);
        if (shift === undefined) return current;
        const amount = (shift.sign * (target - feature.widthMm)) / 2;
        return {
          x: current.x + feature.direction.x * amount,
          y: current.y + feature.direction.y * amount,
        };
      }, point),
    );
    return { ...contour, points };
  });
  if (
    updated.some(
      (contour, index) =>
        !simpleJointPolygon(contour.points) ||
        Math.sign(signedJointArea(contour.points)) !==
          Math.sign(signedJointArea((geometry.contours[index] as Contour).points)),
    )
  )
    return err({
      message:
        'The requested width collapses or crosses the part boundary. Use a smaller change or edit these nodes explicitly.',
    });
  if (!preservesRelations(geometry.contours, updated))
    return err({
      message:
        'The requested width touches another contour or changes opening containment. Review the neighbouring geometry.',
    });
  const paths = geometry.object.paths.map((path, pathIndex) =>
    updatePath(path, pathIndex, updated, geometry.object.transform, features),
  );
  return ok({ ...geometry.object, paths, bounds: boundsForPaths(paths) ?? geometry.object.bounds });
}

function preservesRelations(
  before: ReadonlyArray<Contour>,
  after: ReadonlyArray<Contour>,
): boolean {
  return before.every((a, i) =>
    before.every(
      (b, j) =>
        j <= i ||
        jointContourRelation(a.points, b.points) ===
          jointContourRelation((after[i] as Contour).points, (after[j] as Contour).points),
    ),
  );
}

function updatePath(
  path: ColoredPath,
  pathIndex: number,
  contours: ReadonlyArray<Contour>,
  transform: Transform,
  features: ReadonlyArray<JointCandidate>,
): ColoredPath {
  if (!features.some((feature) => feature.pathIndex === pathIndex)) return path;
  const lines = straightPolylines(path);
  const polylines = lines.map((line, contourIndex) => {
    if (
      !features.some(
        (feature) => feature.pathIndex === pathIndex && feature.contourIndex === contourIndex,
      )
    )
      return line;
    const contour = contours.find(
      (item) => item.pathIndex === pathIndex && item.contourIndex === contourIndex,
    );
    if (contour === undefined) return line;
    const points = contour.points.map((point) => sceneToLocal(point, transform));
    return { closed: true, points: [...points, points[0] as Vec2] };
  });
  const { subpathNesting: _derived, curves: _curves, ...rest } = path;
  return {
    ...rest,
    polylines,
    ...(path.curves === undefined ? {} : { curves: polylines.map(lineCurve) }),
  };
}
function lineCurve(line: Polyline): CurveSubpath {
  const points = normalizeJointPoints(line.points);
  return {
    start: points[0] as Vec2,
    segments: points.slice(1).map((to) => ({ kind: 'line', to })),
    closed: line.closed,
  };
}
function sceneToLocal(point: Vec2, t: Transform): Vec2 {
  const angle = (t.rotationDeg * Math.PI) / 180;
  const x = (point.x - t.x) * Math.cos(angle) + (point.y - t.y) * Math.sin(angle);
  const y = -(point.x - t.x) * Math.sin(angle) + (point.y - t.y) * Math.cos(angle);
  return { x: (x / t.scaleX) * (t.mirrorX ? -1 : 1), y: (y / t.scaleY) * (t.mirrorY ? -1 : 1) };
}
