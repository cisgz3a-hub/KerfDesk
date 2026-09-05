import type { ObjectOperationSettingsOverride } from './scene-object';

const SETTING_KEYS: ReadonlyArray<keyof ObjectOperationSettingsOverride> = [
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
  'hatchAngleDeg',
  'hatchSpacingMm',
  'fillOverscanMm',
  'fillStyle',
  'fillBidirectional',
  'allowUncalibratedBidirectionalScan',
  'bidirectionalScanOffsetMm',
  'fillCrossHatch',
  'ditherAlgorithm',
  'linesPerMm',
  'imageBidirectional',
  'negativeImage',
  'passThrough',
  'dotWidthCorrectionMm',
];

export const objectOperationSettingKeys: ReadonlySet<string> = new Set(SETTING_KEYS);

/** Legacy files tolerate extra metadata. Only recognized process settings may
 * affect an operation: identity, output membership, CNC configuration and the
 * scoped-override container must never be copied over the operation record. */
export function projectObjectOperationSettings(
  value: Readonly<Record<string, unknown>>,
): ObjectOperationSettingsOverride {
  const entries = Object.entries(value);
  if (entries.every(([key, field]) => objectOperationSettingKeys.has(key) && field !== undefined))
    return value as ObjectOperationSettingsOverride;
  return Object.fromEntries(
    entries.filter(([key, field]) => objectOperationSettingKeys.has(key) && field !== undefined),
  ) as ObjectOperationSettingsOverride;
}
