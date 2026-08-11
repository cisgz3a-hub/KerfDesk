import type { MeshReliefObject } from '../../core/scene/relief';
import {
  reliefWidthCommonFactors,
  reliefWidthDimensionsFit,
  type ReliefWidthCommonFactorFailure,
} from './relief-width-common-factor';
import { reliefLegacyWidthFactorCandidate } from './relief-legacy-width-geometry';

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

/** Re-expresses an edited legacy-mesh Width inside the persisted project-v5 domains. */
export function factorReliefLegacyWidth(relief: MeshReliefObject): ReliefLegacyWidthFactorization {
  const dimensions = naturalDimensions(relief);
  if (reliefWidthDimensionsFit(dimensions)) return { kind: 'unchanged', relief };
  const common = reliefWidthCommonFactors(
    dimensions,
    relief.transform.scaleX,
    relief.transform.scaleY,
  );
  if (common.kind === 'unavailable') return unavailable(relief, common.reason);
  const candidate = reliefLegacyWidthFactorCandidate(relief, common.factors);
  return candidate === null
    ? unavailable(relief, 'geometry-drift')
    : { kind: 'factored', relief: candidate };
}

function naturalDimensions(relief: MeshReliefObject): ReadonlyArray<number> {
  return [
    relief.targetWidthMm,
    relief.targetHeightMm,
    relief.bounds.maxX - relief.bounds.minX,
    relief.bounds.maxY - relief.bounds.minY,
  ];
}

function unavailable(
  relief: MeshReliefObject,
  reason: ReliefLegacyWidthFactorizationFailure,
): ReliefLegacyWidthFactorization {
  return { kind: 'unavailable', reason, relief };
}
