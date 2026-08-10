import { meshBounds } from '../../core/relief';
import { applyTransform } from '../../core/scene';
import type { MeshReliefObject } from '../../core/scene/relief';
import {
  reliefWidthCommonFactors,
  reliefWidthDimensionsFit,
  type ReliefWidthCommonFactorFailure,
  type ReliefWidthCommonFactors,
} from './relief-width-common-factor';

export type ReliefLegacyWidthFactorizationFailure =
  | ReliefWidthCommonFactorFailure
  | 'geometry-drift';

export type ReliefLegacyWidthFactorization =
  | { readonly kind: 'unchanged'; readonly relief: MeshReliefObject }
  | { readonly kind: 'factored'; readonly relief: MeshReliefObject }
  | {
      readonly kind: 'unavailable';
      readonly reason: ReliefLegacyWidthFactorizationFailure;
      readonly relief: MeshReliefObject;
    };

/** Re-expresses an edited legacy-mesh Width inside the existing project-v4 domains. */
export function factorReliefLegacyWidth(relief: MeshReliefObject): ReliefLegacyWidthFactorization {
  const dimensions = naturalDimensions(relief);
  if (reliefWidthDimensionsFit(dimensions)) return { kind: 'unchanged', relief };
  const common = reliefWidthCommonFactors(
    dimensions,
    relief.transform.scaleX,
    relief.transform.scaleY,
  );
  if (common.kind === 'unavailable') return unavailable(relief, common.reason);
  const candidate = factoredRelief(relief, common.factors);
  return candidate !== relief && geometryMatches(relief, candidate, common.factors.factor)
    ? { kind: 'factored', relief: candidate }
    : unavailable(relief, 'geometry-drift');
}

function naturalDimensions(relief: MeshReliefObject): ReadonlyArray<number> {
  return [
    relief.targetWidthMm,
    relief.bounds.maxX - relief.bounds.minX,
    relief.bounds.maxY - relief.bounds.minY,
  ];
}

function factoredRelief(
  relief: MeshReliefObject,
  factors: ReliefWidthCommonFactors,
): MeshReliefObject {
  const targetWidthMm = factors.localDimensionsMm[0];
  if (targetWidthMm === undefined) return relief;
  return {
    ...relief,
    targetWidthMm,
    bounds: {
      minX: relief.bounds.minX / factors.factor,
      minY: relief.bounds.minY / factors.factor,
      maxX: relief.bounds.maxX / factors.factor,
      maxY: relief.bounds.maxY / factors.factor,
    },
    transform: { ...relief.transform, scaleX: factors.scaleX, scaleY: factors.scaleY },
  };
}

function geometryMatches(
  intended: MeshReliefObject,
  candidate: MeshReliefObject,
  factor: number,
): boolean {
  return (
    candidate.reliefSource === intended.reliefSource &&
    dimensionsReverseExactly(intended, candidate, factor) &&
    naturalAspectMatches(intended, candidate) &&
    materializerDimensionsMatch(intended, candidate) &&
    transformedCornersMatch(intended, candidate)
  );
}

function dimensionsReverseExactly(
  intended: MeshReliefObject,
  candidate: MeshReliefObject,
  factor: number,
): boolean {
  const before = naturalDimensions(intended);
  const after = naturalDimensions(candidate);
  return (
    after.length === before.length &&
    after.every(
      (dimensionMm, index) => positiveFinite(dimensionMm) && dimensionMm * factor === before[index],
    )
  );
}

function naturalAspectMatches(intended: MeshReliefObject, candidate: MeshReliefObject): boolean {
  const intendedDimensions = naturalDimensions(intended);
  const candidateDimensions = naturalDimensions(candidate);
  const intendedWidthMm = intendedDimensions[1];
  const intendedHeightMm = intendedDimensions[2];
  const candidateWidthMm = candidateDimensions[1];
  const candidateHeightMm = candidateDimensions[2];
  if (
    intendedWidthMm === undefined ||
    intendedHeightMm === undefined ||
    candidateWidthMm === undefined ||
    candidateHeightMm === undefined
  ) {
    return false;
  }
  const intendedAspect = intendedHeightMm / intendedWidthMm;
  const candidateAspect = candidateHeightMm / candidateWidthMm;
  return (
    positiveFinite(intendedAspect) &&
    positiveFinite(candidateAspect) &&
    intendedAspect === candidateAspect
  );
}

function materializerDimensionsMatch(
  intended: MeshReliefObject,
  candidate: MeshReliefObject,
): boolean {
  const aspect = intrinsicMeshAspect(intended);
  if (aspect === null) return false;
  const before = nativeMaterializerDimensions(intended, aspect);
  const after = nativeMaterializerDimensions(candidate, aspect);
  return (
    positiveFinite(before.widthMm) &&
    positiveFinite(before.heightMm) &&
    before.widthMm === after.widthMm &&
    before.heightMm === after.heightMm
  );
}

function intrinsicMeshAspect(relief: MeshReliefObject): number | null {
  const bounds = safelyReadMeshBounds(relief);
  if (bounds === null || !Object.values(bounds).every(Number.isFinite)) return null;
  const xExtent = bounds.maxX - bounds.minX;
  const yExtent = bounds.maxY - bounds.minY;
  if (!positiveFinite(xExtent) || !positiveFinite(yExtent)) return null;
  const aspect = yExtent / xExtent;
  return positiveFinite(aspect) ? aspect : null;
}

function safelyReadMeshBounds(relief: MeshReliefObject): ReturnType<typeof meshBounds> {
  try {
    return meshBounds({ positions: relief.reliefSource.meshPositions });
  } catch {
    return null;
  }
}

function nativeMaterializerDimensions(relief: MeshReliefObject, aspect: number) {
  return {
    widthMm: relief.targetWidthMm * Math.abs(relief.transform.scaleX),
    heightMm: aspect * relief.targetWidthMm * Math.abs(relief.transform.scaleY),
  };
}

function transformedCornersMatch(intended: MeshReliefObject, candidate: MeshReliefObject): boolean {
  const intendedCorners = naturalCorners(intended);
  const candidateCorners = naturalCorners(candidate);
  return intendedCorners.every((point, index) => {
    const candidatePoint = candidateCorners[index];
    if (candidatePoint === undefined) return false;
    const before = applyTransform(point, intended.transform);
    const after = applyTransform(candidatePoint, candidate.transform);
    return (
      Number.isFinite(before.x) &&
      Number.isFinite(before.y) &&
      Number.isFinite(after.x) &&
      Number.isFinite(after.y) &&
      before.x === after.x &&
      before.y === after.y
    );
  });
}

function naturalCorners(
  relief: MeshReliefObject,
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  const bounds = relief.bounds;
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
}

function unavailable(
  relief: MeshReliefObject,
  reason: ReliefLegacyWidthFactorizationFailure,
): ReliefLegacyWidthFactorization {
  return { kind: 'unavailable', reason, relief };
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
