import { applyTransform } from '../../core/scene';
import type { MeshReliefObject } from '../../core/scene/relief';
import type { ReliefWidthCommonFactors } from './relief-width-common-factor';

/** Returns an exact factored legacy-geometry candidate or null when any proof drifts. */
export function reliefLegacyWidthFactorCandidate(
  relief: MeshReliefObject,
  factors: ReliefWidthCommonFactors,
): MeshReliefObject | null {
  const [targetWidthMm, targetHeightMm] = factors.localDimensionsMm;
  if (targetWidthMm === undefined || targetHeightMm === undefined) return null;
  const candidate: MeshReliefObject = {
    ...relief,
    targetWidthMm,
    targetHeightMm,
    bounds: {
      minX: relief.bounds.minX / factors.factor,
      minY: relief.bounds.minY / factors.factor,
      maxX: relief.bounds.maxX / factors.factor,
      maxY: relief.bounds.maxY / factors.factor,
    },
    transform: { ...relief.transform, scaleX: factors.scaleX, scaleY: factors.scaleY },
  };
  return geometryMatches(relief, candidate, factors.factor) ? candidate : null;
}

function geometryMatches(
  intended: MeshReliefObject,
  candidate: MeshReliefObject,
  factor: number,
): boolean {
  return (
    candidate.reliefSource === intended.reliefSource &&
    dimensionsReverseExactly(intended, candidate, factor) &&
    aspectsMatch(intended, candidate) &&
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
  return after.every(
    (dimensionMm, index) => positiveFinite(dimensionMm) && dimensionMm * factor === before[index],
  );
}

function naturalDimensions(relief: MeshReliefObject): ReadonlyArray<number> {
  return [
    relief.targetWidthMm,
    relief.targetHeightMm,
    relief.bounds.maxX - relief.bounds.minX,
    relief.bounds.maxY - relief.bounds.minY,
  ];
}

function aspectsMatch(intended: MeshReliefObject, candidate: MeshReliefObject): boolean {
  return (
    aspectMatches(
      intended.targetWidthMm,
      intended.targetHeightMm,
      candidate.targetWidthMm,
      candidate.targetHeightMm,
    ) &&
    aspectMatches(
      intended.bounds.maxX - intended.bounds.minX,
      intended.bounds.maxY - intended.bounds.minY,
      candidate.bounds.maxX - candidate.bounds.minX,
      candidate.bounds.maxY - candidate.bounds.minY,
    )
  );
}

function aspectMatches(
  intendedWidthMm: number,
  intendedHeightMm: number,
  candidateWidthMm: number,
  candidateHeightMm: number,
): boolean {
  const intendedAspect = intendedHeightMm / intendedWidthMm;
  return positiveFinite(intendedAspect) && intendedAspect === candidateHeightMm / candidateWidthMm;
}

function materializerDimensionsMatch(
  intended: MeshReliefObject,
  candidate: MeshReliefObject,
): boolean {
  if (!intrinsicMeshCanMaterialize(intended)) return false;
  const before = nativeMaterializerDimensions(intended);
  const after = nativeMaterializerDimensions(candidate);
  return (
    positiveFinite(before.widthMm) &&
    positiveFinite(before.heightMm) &&
    before.widthMm === after.widthMm &&
    before.heightMm === after.heightMm
  );
}

function intrinsicMeshCanMaterialize(relief: MeshReliefObject): boolean {
  const bounds = relief.reliefSource.intrinsicBounds;
  if (bounds.kind !== 'finite-float32-v1') return false;
  return positiveFinite(bounds.maxX - bounds.minX) && positiveFinite(bounds.maxY - bounds.minY);
}

function nativeMaterializerDimensions(relief: MeshReliefObject) {
  return {
    widthMm: relief.targetWidthMm * Math.abs(relief.transform.scaleX),
    heightMm: relief.targetHeightMm * Math.abs(relief.transform.scaleY),
  };
}

function transformedCornersMatch(intended: MeshReliefObject, candidate: MeshReliefObject): boolean {
  const candidateCorners = naturalCorners(candidate);
  return naturalCorners(intended).every((point, index) => {
    const candidatePoint = candidateCorners[index];
    if (candidatePoint === undefined) return false;
    const before = applyTransform(point, intended.transform);
    const after = applyTransform(candidatePoint, candidate.transform);
    return (
      Number.isFinite(before.x) &&
      Number.isFinite(before.y) &&
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

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
