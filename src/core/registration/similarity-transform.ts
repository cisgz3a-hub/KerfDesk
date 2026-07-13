import type { Project, SceneObject, Vec2 } from '../scene';

export type TwoPointRegistration = {
  readonly design: readonly [Vec2, Vec2];
  readonly machine: readonly [Vec2, Vec2];
};

export type SimilarityTransform = {
  readonly scale: number;
  readonly rotationRad: number;
  readonly translation: Vec2;
};

export type SimilarityTransformResult =
  | { readonly ok: true; readonly transform: SimilarityTransform }
  | { readonly ok: false; readonly reason: string };

const MIN_TARGET_DISTANCE_MM = 0.001;

export function solveTwoPointRegistration(
  registration: TwoPointRegistration,
): SimilarityTransformResult {
  const designVector = subtract(registration.design[1], registration.design[0]);
  const machineVector = subtract(registration.machine[1], registration.machine[0]);
  const designLength = length(designVector);
  const machineLength = length(machineVector);
  if (designLength < MIN_TARGET_DISTANCE_MM || machineLength < MIN_TARGET_DISTANCE_MM) {
    return { ok: false, reason: 'Registration targets must be distinct.' };
  }
  const scale = machineLength / designLength;
  const rotationRad = angle(machineVector) - angle(designVector);
  const mappedFirst = rotateScale(registration.design[0], scale, rotationRad);
  return {
    ok: true,
    transform: {
      scale,
      rotationRad,
      translation: subtract(registration.machine[0], mappedFirst),
    },
  };
}

export function applySimilarityPoint(point: Vec2, transform: SimilarityTransform): Vec2 {
  const mapped = rotateScale(point, transform.scale, transform.rotationRad);
  return { x: mapped.x + transform.translation.x, y: mapped.y + transform.translation.y };
}

export function invertSimilarity(transform: SimilarityTransform): SimilarityTransform {
  const scale = 1 / transform.scale;
  const rotationRad = -transform.rotationRad;
  const inverseTranslation = rotateScale(
    { x: -transform.translation.x, y: -transform.translation.y },
    scale,
    rotationRad,
  );
  return { scale, rotationRad, translation: inverseTranslation };
}

export function applySimilarityProject(project: Project, transform: SimilarityTransform): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((object) => applySimilarityObject(object, transform)),
    },
  };
}

function applySimilarityObject(object: SceneObject, transform: SimilarityTransform): SceneObject {
  const position = applySimilarityPoint(
    { x: object.transform.x, y: object.transform.y },
    transform,
  );
  return {
    ...object,
    transform: {
      ...object.transform,
      ...position,
      scaleX: object.transform.scaleX * transform.scale,
      scaleY: object.transform.scaleY * transform.scale,
      rotationDeg: normalizeDegrees(
        object.transform.rotationDeg + (transform.rotationRad * 180) / Math.PI,
      ),
    },
  } as SceneObject;
}

function rotateScale(point: Vec2, scale: number, radians: number): Vec2 {
  const cosine = Math.cos(radians) * scale;
  const sine = Math.sin(radians) * scale;
  return { x: point.x * cosine - point.y * sine, y: point.x * sine + point.y * cosine };
}

function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function length(vector: Vec2): number {
  return Math.hypot(vector.x, vector.y);
}

function angle(vector: Vec2): number {
  return Math.atan2(vector.y, vector.x);
}

function normalizeDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}
