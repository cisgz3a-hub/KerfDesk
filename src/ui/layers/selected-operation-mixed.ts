import type { LayerOperationSettings } from '../../core/scene';

export type MixedOperationFields = Partial<Record<keyof LayerOperationSettings, boolean>>;

const OPERATION_SETTING_KEYS = [
  'mode',
  'minPower',
  'power',
  'speed',
  'passes',
  'airAssist',
  'kerfOffsetMm',
  'tabsEnabled',
  'tabSizeMm',
  'tabsPerShape',
  'tabSkipInnerShapes',
  'fillStyle',
  'hatchAngleDeg',
  'hatchSpacingMm',
  'fillOverscanMm',
  'fillBidirectional',
  'fillCrossHatch',
  'ditherAlgorithm',
  'linesPerMm',
  'imageBidirectional',
  'negativeImage',
  'passThrough',
  'dotWidthCorrectionMm',
] as const satisfies ReadonlyArray<keyof LayerOperationSettings>;

export function mixedOperationFields(
  first: LayerOperationSettings,
  settings: ReadonlyArray<LayerOperationSettings | undefined>,
): MixedOperationFields {
  const mixed: MixedOperationFields = {};
  for (const key of OPERATION_SETTING_KEYS) {
    if (
      settings.some(
        (candidate) => candidate === undefined || !Object.is(candidate[key], first[key]),
      )
    ) {
      mixed[key] = true;
    }
  }
  return mixed;
}

export function hasMixedFields(mixed: MixedOperationFields): boolean {
  return OPERATION_SETTING_KEYS.some((key) => mixed[key] === true);
}
