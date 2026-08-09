import type { ReliefObject } from '../../core/scene';
import type { HeightfieldReliefObject, ReliefHeightfieldMapping } from '../../core/scene/relief';

/** Operator-editable relief parameters accepted by the shared relief state action. */
export type ReliefParamPatch = {
  targetWidthMm?: number;
  reliefDepthMm?: number;
  emptyCells?: 'floor' | 'top';
  polarity?: 'light-is-high' | 'light-is-deep';
  inputLowCode?: number;
  inputHighCode?: number;
  gamma?: number;
  outsideMask?: ReliefHeightfieldMapping['outsideMask'];
};

/** Retains only factual values that the durable relief model can represent exactly. */
export function normalizeReliefPatch(patch: ReliefParamPatch): ReliefParamPatch {
  const out: ReliefParamPatch = {};
  if (positiveFinite(patch.targetWidthMm)) out.targetWidthMm = patch.targetWidthMm;
  if (positiveFinite(patch.reliefDepthMm)) out.reliefDepthMm = patch.reliefDepthMm;
  if (patch.emptyCells !== undefined) out.emptyCells = patch.emptyCells;
  if (patch.polarity !== undefined) out.polarity = patch.polarity;
  if (isU16Code(patch.inputLowCode)) out.inputLowCode = patch.inputLowCode;
  if (isU16Code(patch.inputHighCode)) out.inputHighCode = patch.inputHighCode;
  if (positiveFinite(patch.gamma)) out.gamma = patch.gamma;
  if (isOutsideMask(patch.outsideMask)) out.outsideMask = patch.outsideMask;
  return out;
}

/** Reports whether normalization retained at least one relief parameter. */
export function hasReliefPatch(patch: ReliefParamPatch): boolean {
  return (
    patch.targetWidthMm !== undefined ||
    patch.reliefDepthMm !== undefined ||
    patch.emptyCells !== undefined ||
    patch.polarity !== undefined ||
    patch.inputLowCode !== undefined ||
    patch.inputHighCode !== undefined ||
    patch.gamma !== undefined ||
    patch.outsideMask !== undefined
  );
}

/** Identifies mapping-only edits that leave the selected relief byte-for-byte unchanged. */
export function isNoOpHeightfieldMappingPatch(
  relief: ReliefObject,
  patch: ReliefParamPatch,
): boolean {
  const hasMappingPatch = [
    patch.inputLowCode,
    patch.inputHighCode,
    patch.gamma,
    patch.outsideMask,
  ].some(isDefined);
  const hasOtherPatch = [
    patch.targetWidthMm,
    patch.reliefDepthMm,
    patch.emptyCells,
    patch.polarity,
  ].some(isDefined);
  if (!hasMappingPatch || hasOtherPatch) return false;
  if (relief.reliefSource.kind === 'legacy-mesh') return true;
  const mapping = relief.reliefSource.mapping;
  return (
    isUnchanged(patch.inputLowCode, mapping.inputLowCode) &&
    isUnchanged(patch.inputHighCode, mapping.inputHighCode) &&
    isUnchanged(patch.gamma, mapping.curve.gamma) &&
    isUnchanged(patch.outsideMask, mapping.outsideMask)
  );
}

/** Applies canonical heightfield parameters while preserving untouched source identities. */
export function applyHeightfieldReliefPatch(
  relief: HeightfieldReliefObject,
  common: Partial<Pick<ReliefObject, 'targetWidthMm' | 'reliefDepthMm'>>,
  patch: ReliefParamPatch,
): HeightfieldReliefObject {
  const canonicalChanged =
    widthPatchChangesSource(relief, patch.targetWidthMm) ||
    mappingPatchChangesSource(relief, patch);
  return {
    ...relief,
    ...common,
    reliefSource: {
      ...relief.reliefSource,
      ...physicalDimensionsForWidth(relief, patch.targetWidthMm),
      mapping: {
        ...relief.reliefSource.mapping,
        ...(patch.reliefDepthMm === undefined ? {} : { maxDepthMm: patch.reliefDepthMm }),
        ...(patch.polarity === undefined ? {} : { polarity: patch.polarity }),
        ...(patch.inputLowCode === undefined ? {} : { inputLowCode: patch.inputLowCode }),
        ...(patch.inputHighCode === undefined ? {} : { inputHighCode: patch.inputHighCode }),
        ...(patch.gamma === undefined
          ? {}
          : { curve: { ...relief.reliefSource.mapping.curve, gamma: patch.gamma } }),
        ...(patch.outsideMask === undefined ? {} : { outsideMask: patch.outsideMask }),
      },
      revision: relief.reliefSource.revision + (canonicalChanged ? 1 : 0),
    },
  };
}

function mappingPatchChangesSource(
  relief: HeightfieldReliefObject,
  patch: ReliefParamPatch,
): boolean {
  const mapping = relief.reliefSource.mapping;
  const nextDepthMm = patch.reliefDepthMm ?? relief.reliefDepthMm;
  const nextPolarity = patch.polarity ?? mapping.polarity;
  const nextInputLowCode = patch.inputLowCode ?? mapping.inputLowCode;
  const nextInputHighCode = patch.inputHighCode ?? mapping.inputHighCode;
  const nextGamma = patch.gamma ?? mapping.curve.gamma;
  const nextOutsideMask = patch.outsideMask ?? mapping.outsideMask;
  return (
    nextDepthMm !== mapping.maxDepthMm ||
    nextPolarity !== mapping.polarity ||
    nextInputLowCode !== mapping.inputLowCode ||
    nextInputHighCode !== mapping.inputHighCode ||
    nextGamma !== mapping.curve.gamma ||
    nextOutsideMask !== mapping.outsideMask
  );
}

function widthPatchChangesSource(
  relief: HeightfieldReliefObject,
  widthMm: number | undefined,
): boolean {
  return widthMm !== undefined && widthMm !== relief.reliefSource.physicalWidthMm;
}

function physicalDimensionsForWidth(
  relief: HeightfieldReliefObject,
  widthMm: number | undefined,
): Partial<Pick<HeightfieldReliefObject['reliefSource'], 'physicalWidthMm' | 'physicalHeightMm'>> {
  if (widthMm === undefined) return {};
  const aspect = relief.reliefSource.physicalHeightMm / relief.reliefSource.physicalWidthMm;
  return { physicalWidthMm: widthMm, physicalHeightMm: widthMm * aspect };
}

function positiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

const MAX_U16_CODE = 0xffff;

function isU16Code(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_U16_CODE
  );
}

function isOutsideMask(value: unknown): value is ReliefHeightfieldMapping['outsideMask'] {
  return value === 'excluded' || value === 'stock-top' || value === 'relief-floor';
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isUnchanged<T>(value: T | undefined, current: T): boolean {
  return value === undefined || value === current;
}
