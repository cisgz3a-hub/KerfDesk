import { createPolyline, CURRENT_POLYLINE_FAIRING_VERSION } from '../../core/shapes';
import type {
  CurveSubpath,
  PathSegment,
  Project,
  SceneObject,
  ShapeObject,
  Vec2,
} from '../../core/scene';
import { fitLegacyCentripetalCubics } from '../../core/trace/centerline/curve-cubics';

export type PolylineFairingUpgrade = {
  readonly project: Project;
  readonly upgradedCount: number;
};

/** Upgrade stored pen drawings that predate tracer-backed cubic fairing. */
export function upgradeProjectPolylineFairing(project: Project): PolylineFairingUpgrade {
  let upgradedCount = 0;
  const objects = project.scene.objects.map((object) => {
    const upgraded = upgradePolylineObject(object);
    if (upgraded !== object) upgradedCount += 1;
    return upgraded;
  });
  if (upgradedCount === 0) return { project, upgradedCount };
  return {
    project: { ...project, scene: { ...project.scene, objects } },
    upgradedCount,
  };
}

function upgradePolylineObject(object: SceneObject): SceneObject {
  if (object.kind !== 'shape' || object.spec.kind !== 'polyline') return object;
  // A drawing stamped at the current fairing version was produced by this
  // engine version — trust the stamp instead of re-deriving fitter output and
  // comparing JSON, which a future fitter change would silently break (ADR-214).
  // A newer stamp (a file from a future build) is likewise left untouched.
  if (
    object.fairingVersion !== undefined &&
    object.fairingVersion >= CURRENT_POLYLINE_FAIRING_VERSION
  ) {
    return object;
  }
  const legacy = createPolyline({
    id: object.id,
    color: object.color,
    spec: object.spec,
    transform: object.transform,
    fairingMode: 'corner-preserving',
  });
  if (
    hasAuthoredCurve(object) &&
    !hasSameCurves(object, legacy) &&
    !hasLegacyRoundAdapterCurve(object, object.spec.points, object.spec.closed)
  ) {
    return object;
  }
  const rematerialized = createPolyline({
    id: object.id,
    color: object.color,
    spec: object.spec,
    transform: object.transform,
  });
  if (!hasAuthoredCurve(rematerialized)) return object;
  if (hasSameCurves(object, rematerialized)) return object;
  return {
    ...object,
    bounds: rematerialized.bounds,
    paths: rematerialized.paths,
    fairingVersion: CURRENT_POLYLINE_FAIRING_VERSION,
  };
}

function hasAuthoredCurve(object: ShapeObject): boolean {
  return object.paths.some((path) =>
    path.curves?.some((curve) => curve.segments.some((segment) => segment.kind !== 'line')),
  );
}

function hasSameCurves(left: ShapeObject, right: ShapeObject): boolean {
  if (left.paths.length !== right.paths.length) return false;
  return left.paths.every((path, index) => {
    const other = right.paths[index];
    return other !== undefined && JSON.stringify(path.curves) === JSON.stringify(other.curves);
  });
}

function hasLegacyRoundAdapterCurve(
  object: ShapeObject,
  points: ReadonlyArray<Vec2>,
  closed: boolean,
): boolean {
  const pointCount = points.length;
  const minimumPoints = closed ? 5 : 4;
  if (pointCount < minimumPoints) return false;
  const curve = legacyRoundAdapterCurve(points, closed);
  return JSON.stringify(object.paths[0]?.curves) === JSON.stringify([curve]);
}

function legacyRoundAdapterCurve(points: ReadonlyArray<Vec2>, closed: boolean): CurveSubpath {
  const unique = points.filter((point, index) => {
    const previous = points[index - 1];
    return previous === undefined || Math.hypot(point.x - previous.x, point.y - previous.y) >= 1e-9;
  });
  const first = unique[0];
  const last = unique.at(-1);
  const source =
    closed &&
    first !== undefined &&
    last !== undefined &&
    Math.hypot(last.x - first.x, last.y - first.y) < 1e-9
      ? unique.slice(0, -1)
      : unique;
  const cubics = fitLegacyCentripetalCubics(source, closed);
  return {
    start: cubics[0]?.p0 ?? source[0] ?? { x: 0, y: 0 },
    closed,
    segments: cubics.map<PathSegment>((cubic) => ({
      kind: 'cubic',
      control1: cubic.p1,
      control2: cubic.p2,
      to: cubic.p3,
    })),
  };
}
