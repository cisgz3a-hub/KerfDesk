import type { ReliefHeightfield, ReliefHeightfieldMapping } from '../../core/scene/relief';
import { positiveFloat64ProductQuotient } from '../positive-float64-rational';
const PRESERVE_ASPECT: ReliefHeightfieldMapping['aspect'] = 'preserve';
const STRETCH_ASPECT: ReliefHeightfieldMapping['aspect'] = 'stretch';

type WidthResolutionInput = {
  readonly currentWidthMm: number;
  readonly currentHeightMm: number;
  readonly currentAspect: ReliefHeightfieldMapping['aspect'];
  readonly requestedWidthMm: number;
};

type WidthResolution = {
  readonly physicalWidthMm: number;
  readonly physicalHeightMm: number;
  readonly aspect: ReliefHeightfieldMapping['aspect'];
};

/** Resolves an accepted Width edit without losing a representable aspect-preserved height. */
export function resolveReliefHeightfieldWidth(input: WidthResolutionInput): WidthResolution {
  if (input.currentAspect === STRETCH_ASPECT) return retainedHeight(input);
  const physicalHeightMm = roundedAspectHeight(input);
  return physicalHeightMm > 0 && Number.isFinite(physicalHeightMm)
    ? { physicalWidthMm: input.requestedWidthMm, physicalHeightMm, aspect: PRESERVE_ASPECT }
    : retainedHeight(input);
}

/** Resolves an optional Width patch from the canonical field authority. */
export function resolveReliefHeightfieldWidthPatch(
  source: ReliefHeightfield,
  requestedWidthMm: number | undefined,
): WidthResolution | undefined {
  if (requestedWidthMm === undefined) return undefined;
  return resolveReliefHeightfieldWidth({
    currentWidthMm: source.physicalWidthMm,
    currentHeightMm: source.physicalHeightMm,
    currentAspect: source.mapping.aspect,
    requestedWidthMm,
  });
}

function retainedHeight(input: WidthResolutionInput): WidthResolution {
  return {
    physicalWidthMm: input.requestedWidthMm,
    physicalHeightMm: input.currentHeightMm,
    aspect: STRETCH_ASPECT,
  };
}

function roundedAspectHeight(input: WidthResolutionInput): number {
  return positiveFloat64ProductQuotient(
    [input.requestedWidthMm, input.currentHeightMm],
    [input.currentWidthMm],
  );
}
