import { MAX_PROJECT_COORDINATE_MAGNITUDE_MM, MAX_PROJECT_TRANSFORM_SCALE } from '../../io/project';

const POWER_OF_TWO_FACTOR = 2;

export type ReliefWidthCommonFactorFailure =
  | 'zero-scale'
  | 'scale-domain'
  | 'numeric-domain'
  | 'factor-drift';

export type ReliefWidthCommonFactors = {
  readonly localDimensionsMm: ReadonlyArray<number>;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly factor: number;
};

export type ReliefWidthCommonFactorResult =
  | { readonly kind: 'available'; readonly factors: ReliefWidthCommonFactors }
  | { readonly kind: 'unavailable'; readonly reason: ReliefWidthCommonFactorFailure };

/** Finds the smallest exact common power-of-two factor for local dimensions and XY scales. */
export function reliefWidthCommonFactors(
  localDimensionsMm: ReadonlyArray<number>,
  scaleX: number,
  scaleY: number,
): ReliefWidthCommonFactorResult {
  if (scaleX === 0 || scaleY === 0) return { kind: 'unavailable', reason: 'zero-scale' };
  const initial: ReliefWidthCommonFactors = {
    localDimensionsMm,
    scaleX,
    scaleY,
    factor: 1,
  };
  const bounded = accumulateCommonFactor(initial);
  if (bounded.kind === 'unavailable') return bounded;
  return factorReversesExactly(initial, bounded.factors)
    ? bounded
    : { kind: 'unavailable', reason: 'factor-drift' };
}

export function reliefWidthDimensionsFit(localDimensionsMm: ReadonlyArray<number>): boolean {
  return (
    localDimensionsMm.every(positiveFinite) &&
    reliefWidthDimensionsWithinCoordinateCap(localDimensionsMm)
  );
}

/** Retains the heightfield factorizer's pre-existing bounded compatibility classification. */
export function reliefWidthDimensionsWithinCoordinateCap(
  localDimensionsMm: ReadonlyArray<number>,
): boolean {
  return localDimensionsMm.every(
    (dimensionMm) => dimensionMm <= MAX_PROJECT_COORDINATE_MAGNITUDE_MM,
  );
}

function accumulateCommonFactor(initial: ReliefWidthCommonFactors): ReliefWidthCommonFactorResult {
  let factors = initial;
  while (!reliefWidthDimensionsFit(factors.localDimensionsMm)) {
    factors = {
      localDimensionsMm: factors.localDimensionsMm.map(
        (dimensionMm) => dimensionMm / POWER_OF_TWO_FACTOR,
      ),
      scaleX: factors.scaleX * POWER_OF_TWO_FACTOR,
      scaleY: factors.scaleY * POWER_OF_TWO_FACTOR,
      factor: factors.factor * POWER_OF_TWO_FACTOR,
    };
    if (!factors.localDimensionsMm.every(positiveFinite)) {
      return { kind: 'unavailable', reason: 'numeric-domain' };
    }
    if (!persistableScale(factors.scaleX) || !persistableScale(factors.scaleY)) {
      return { kind: 'unavailable', reason: 'scale-domain' };
    }
  }
  return { kind: 'available', factors };
}

function factorReversesExactly(
  initial: ReliefWidthCommonFactors,
  candidate: ReliefWidthCommonFactors,
): boolean {
  return (
    candidate.localDimensionsMm.length === initial.localDimensionsMm.length &&
    candidate.localDimensionsMm.every(
      (dimensionMm, index) => dimensionMm * candidate.factor === initial.localDimensionsMm[index],
    ) &&
    candidate.scaleX / candidate.factor === initial.scaleX &&
    candidate.scaleY / candidate.factor === initial.scaleY
  );
}

function persistableScale(scale: number): boolean {
  return Number.isFinite(scale) && Math.abs(scale) <= MAX_PROJECT_TRANSFORM_SCALE;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
