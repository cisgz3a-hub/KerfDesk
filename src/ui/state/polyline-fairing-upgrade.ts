import { createPolyline } from '../../core/shapes';
import type { Project, SceneObject, ShapeObject } from '../../core/scene';

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
  const legacy = createPolyline({
    id: object.id,
    color: object.color,
    spec: object.spec,
    transform: object.transform,
    fairingMode: 'corner-preserving',
  });
  if (hasAuthoredCurve(object) && !hasSameCurves(object, legacy)) return object;
  const rematerialized = createPolyline({
    id: object.id,
    color: object.color,
    spec: object.spec,
    transform: object.transform,
  });
  if (!hasAuthoredCurve(rematerialized)) return object;
  if (hasSameCurves(object, rematerialized)) return object;
  return { ...object, bounds: rematerialized.bounds, paths: rematerialized.paths };
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
