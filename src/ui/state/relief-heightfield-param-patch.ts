import type { ReliefObject } from '../../core/scene';
import type { HeightfieldReliefObject, ReliefHeightfieldMapping } from '../../core/scene/relief';
import { resolveReliefHeightfieldWidthPatch } from './relief-heightfield-width-resolution';

/** Operator-editable relief parameters accepted by the shared relief state action. */
export type ReliefParamPatch = {
  targetWidthMm?: number;
  reliefDepthMm?: number;
  emptyCells?: 'floor' | 'top';
  polarity?: 'light-is-high' | 'light-is-deep';
  inputLowCode?: number;
  inputHighCode?: number;
  gamma?: number;
  inclusionThreshold?: number;
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
  if (isInclusionThreshold(patch.inclusionThreshold)) {
    out.inclusionThreshold = patch.inclusionThreshold;
  }
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
    patch.inclusionThreshold !== undefined ||
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
    patch.inclusionThreshold,
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
    isUnchanged(patch.inclusionThreshold, mapping.inclusionThreshold) &&
    isUnchanged(patch.outsideMask, mapping.outsideMask)
  );
}

/** Applies canonical heightfield parameters while preserving untouched source identities. */
export function applyHeightfieldReliefPatch(
  relief: HeightfieldReliefObject,
  common: Partial<Pick<ReliefObject, 'targetWidthMm' | 'reliefDepthMm'>>,
  patch: ReliefParamPatch,
): HeightfieldReliefObject {
  const widthResolution = resolveReliefHeightfieldWidthPatch(
    relief.reliefSource,
    patch.targetWidthMm,
  );
  const canonicalChanged =
    widthPatchChangesSource(relief, patch.targetWidthMm) ||
    mappingPatchChangesSource(relief, patch);
  return {
    ...relief,
    ...common,
    reliefSource: {
      ...relief.reliefSource,
      ...(widthResolution === undefined
        ? {}
        : {
            physicalWidthMm: widthResolution.physicalWidthMm,
            physicalHeightMm: widthResolution.physicalHeightMm,
          }),
      mapping: {
        ...relief.reliefSource.mapping,
        ...(widthResolution === undefined ? {} : { aspect: widthResolution.aspect }),
        ...(patch.reliefDepthMm === undefined ? {} : { maxDepthMm: patch.reliefDepthMm }),
        ...(patch.polarity === undefined ? {} : { polarity: patch.polarity }),
        ...(patch.inputLowCode === undefined ? {} : { inputLowCode: patch.inputLowCode }),
        ...(patch.inputHighCode === undefined ? {} : { inputHighCode: patch.inputHighCode }),
        ...(patch.gamma === undefined
          ? {}
          : { curve: { ...relief.reliefSource.mapping.curve, gamma: patch.gamma } }),
        ...(patch.inclusionThreshold === undefined
          ? {}
          : { inclusionThreshold: patch.inclusionThreshold }),
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
  const current = [
    mapping.maxDepthMm,
    mapping.polarity,
    mapping.inputLowCode,
    mapping.inputHighCode,
    mapping.curve.gamma,
    mapping.inclusionThreshold,
    mapping.outsideMask,
  ];
  const next = [
    patch.reliefDepthMm ?? relief.reliefDepthMm,
    patch.polarity ?? mapping.polarity,
    patch.inputLowCode ?? mapping.inputLowCode,
    patch.inputHighCode ?? mapping.inputHighCode,
    patch.gamma ?? mapping.curve.gamma,
    patch.inclusionThreshold ?? mapping.inclusionThreshold,
    patch.outsideMask ?? mapping.outsideMask,
  ];
  return next.some((value, index) => value !== current[index]);
}

function widthPatchChangesSource(
  relief: HeightfieldReliefObject,
  widthMm: number | undefined,
): boolean {
  return widthMm !== undefined && widthMm !== relief.reliefSource.physicalWidthMm;
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

function isInclusionThreshold(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 0xff;
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
