import { applyTransform } from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/relief';
import { MAX_PROJECT_COORDINATE_MAGNITUDE_MM, MAX_PROJECT_TRANSFORM_SCALE } from '../../io/project';

const COMMON_FACTOR = 2;

export type ReliefHeightfieldWidthFactorizationFailure =
  | 'zero-scale'
  | 'scale-domain'
  | 'numeric-domain'
  | 'factor-drift'
  | 'geometry-drift';

export type ReliefHeightfieldWidthFactorization =
  | { readonly kind: 'unchanged'; readonly relief: HeightfieldReliefObject }
  | { readonly kind: 'factored'; readonly relief: HeightfieldReliefObject }
  | {
      readonly kind: 'unavailable';
      readonly reason: ReliefHeightfieldWidthFactorizationFailure;
      readonly relief: HeightfieldReliefObject;
    };

type CommonFactors = {
  readonly physicalWidthMm: number;
  readonly physicalHeightMm: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly factor: number;
};

type CommonFactorResult =
  | { readonly kind: 'available'; readonly factors: CommonFactors }
  | { readonly kind: 'unavailable'; readonly reason: ReliefHeightfieldWidthFactorizationFailure };

/** Re-expresses an edited heightfield Width inside the existing project-v4 numeric domains. */
export function factorReliefHeightfieldWidth(
  relief: HeightfieldReliefObject,
): ReliefHeightfieldWidthFactorization {
  const source = relief.reliefSource;
  if (dimensionsFit(source.physicalWidthMm, source.physicalHeightMm)) {
    return { kind: 'unchanged', relief };
  }
  const common = commonFactors(relief);
  if (common.kind === 'unavailable') return unavailable(relief, common.reason);
  const candidate = factoredRelief(relief, common.factors);
  return machineDimensionsMatch(relief, candidate) && transformedCornersMatch(relief, candidate)
    ? { kind: 'factored', relief: candidate }
    : unavailable(relief, 'geometry-drift');
}

function commonFactors(relief: HeightfieldReliefObject): CommonFactorResult {
  if (relief.transform.scaleX === 0 || relief.transform.scaleY === 0) {
    return { kind: 'unavailable', reason: 'zero-scale' };
  }
  const factors: CommonFactors = {
    physicalWidthMm: relief.reliefSource.physicalWidthMm,
    physicalHeightMm: relief.reliefSource.physicalHeightMm,
    scaleX: relief.transform.scaleX,
    scaleY: relief.transform.scaleY,
    factor: 1,
  };
  const bounded = accumulateCommonFactor(factors);
  if (bounded.kind === 'unavailable') return bounded;
  return factorReversesExactly(relief, bounded.factors)
    ? bounded
    : { kind: 'unavailable', reason: 'factor-drift' };
}

function accumulateCommonFactor(initial: CommonFactors): CommonFactorResult {
  let factors = initial;
  while (!dimensionsFit(factors.physicalWidthMm, factors.physicalHeightMm)) {
    factors = {
      physicalWidthMm: factors.physicalWidthMm / COMMON_FACTOR,
      physicalHeightMm: factors.physicalHeightMm / COMMON_FACTOR,
      scaleX: factors.scaleX * COMMON_FACTOR,
      scaleY: factors.scaleY * COMMON_FACTOR,
      factor: factors.factor * COMMON_FACTOR,
    };
    if (!positiveFinite(factors.physicalWidthMm) || !positiveFinite(factors.physicalHeightMm)) {
      return { kind: 'unavailable', reason: 'numeric-domain' };
    }
    if (!persistableScale(factors.scaleX) || !persistableScale(factors.scaleY)) {
      return { kind: 'unavailable', reason: 'scale-domain' };
    }
  }
  return { kind: 'available', factors };
}

function factorReversesExactly(relief: HeightfieldReliefObject, factors: CommonFactors): boolean {
  return (
    factors.physicalWidthMm * factors.factor === relief.reliefSource.physicalWidthMm &&
    factors.physicalHeightMm * factors.factor === relief.reliefSource.physicalHeightMm &&
    factors.scaleX / factors.factor === relief.transform.scaleX &&
    factors.scaleY / factors.factor === relief.transform.scaleY
  );
}

function factoredRelief(
  relief: HeightfieldReliefObject,
  factors: CommonFactors,
): HeightfieldReliefObject {
  return {
    ...relief,
    targetWidthMm: factors.physicalWidthMm,
    bounds: {
      minX: 0,
      minY: 0,
      maxX: factors.physicalWidthMm,
      maxY: factors.physicalHeightMm,
    },
    transform: { ...relief.transform, scaleX: factors.scaleX, scaleY: factors.scaleY },
    reliefSource: {
      ...relief.reliefSource,
      physicalWidthMm: factors.physicalWidthMm,
      physicalHeightMm: factors.physicalHeightMm,
    },
  };
}

function unavailable(
  relief: HeightfieldReliefObject,
  reason: ReliefHeightfieldWidthFactorizationFailure,
): ReliefHeightfieldWidthFactorization {
  return { kind: 'unavailable', reason, relief };
}

function dimensionsFit(widthMm: number, heightMm: number): boolean {
  return (
    widthMm <= MAX_PROJECT_COORDINATE_MAGNITUDE_MM &&
    heightMm <= MAX_PROJECT_COORDINATE_MAGNITUDE_MM
  );
}

function persistableScale(scale: number): boolean {
  return Number.isFinite(scale) && Math.abs(scale) <= MAX_PROJECT_TRANSFORM_SCALE;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
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
