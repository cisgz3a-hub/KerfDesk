import { applyTransform } from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/relief';
import * as widthFactorization from './relief-width-common-factor';

export type ReliefHeightfieldWidthFactorizationFailure =
  | widthFactorization.ReliefWidthCommonFactorFailure
  | 'geometry-drift';

export type ReliefHeightfieldWidthFactorization =
  | { readonly kind: 'unchanged'; readonly relief: HeightfieldReliefObject }
  | { readonly kind: 'factored'; readonly relief: HeightfieldReliefObject }
  | {
      readonly kind: 'unavailable';
      readonly reason: ReliefHeightfieldWidthFactorizationFailure;
      readonly relief: HeightfieldReliefObject;
    };

/** Re-expresses an edited heightfield Width inside the existing project-v4 numeric domains. */
export function factorReliefHeightfieldWidth(
  relief: HeightfieldReliefObject,
): ReliefHeightfieldWidthFactorization {
  const source = relief.reliefSource;
  const dimensions = [source.physicalWidthMm, source.physicalHeightMm];
  if (widthFactorization.reliefWidthDimensionsWithinCoordinateCap(dimensions)) {
    return { kind: 'unchanged', relief };
  }
  const common = widthFactorization.reliefWidthCommonFactors(
    dimensions,
    relief.transform.scaleX,
    relief.transform.scaleY,
  );
  if (common.kind === 'unavailable') return unavailable(relief, common.reason);
  const candidate = factoredRelief(relief, common.factors);
  return machineDimensionsMatch(relief, candidate) && transformedCornersMatch(relief, candidate)
    ? { kind: 'factored', relief: candidate }
    : unavailable(relief, 'geometry-drift');
}

function factoredRelief(
  relief: HeightfieldReliefObject,
  factors: widthFactorization.ReliefWidthCommonFactors,
): HeightfieldReliefObject {
  const physicalWidthMm = factors.localDimensionsMm[0];
  const physicalHeightMm = factors.localDimensionsMm[1];
  if (physicalWidthMm === undefined || physicalHeightMm === undefined) return relief;
  return {
    ...relief,
    targetWidthMm: physicalWidthMm,
    bounds: {
      minX: 0,
      minY: 0,
      maxX: physicalWidthMm,
      maxY: physicalHeightMm,
    },
    transform: { ...relief.transform, scaleX: factors.scaleX, scaleY: factors.scaleY },
    reliefSource: {
      ...relief.reliefSource,
      physicalWidthMm,
      physicalHeightMm,
    },
  };
}

function unavailable(
  relief: HeightfieldReliefObject,
  reason: ReliefHeightfieldWidthFactorizationFailure,
): ReliefHeightfieldWidthFactorization {
  return { kind: 'unavailable', reason, relief };
}

function machineDimensionsMatch(
  intended: HeightfieldReliefObject,
  candidate: HeightfieldReliefObject,
): boolean {
  return (
    intended.reliefSource.physicalWidthMm * Math.abs(intended.transform.scaleX) ===
      candidate.reliefSource.physicalWidthMm * Math.abs(candidate.transform.scaleX) &&
    intended.reliefSource.physicalHeightMm * Math.abs(intended.transform.scaleY) ===
      candidate.reliefSource.physicalHeightMm * Math.abs(candidate.transform.scaleY)
  );
}

function transformedCornersMatch(
  intended: HeightfieldReliefObject,
  candidate: HeightfieldReliefObject,
): boolean {
  const intendedCorners = physicalCorners(intended);
  const candidateCorners = physicalCorners(candidate);
  return intendedCorners.every((point, index) => {
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

function physicalCorners(
  relief: HeightfieldReliefObject,
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  const { physicalWidthMm: width, physicalHeightMm: height } = relief.reliefSource;
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}
