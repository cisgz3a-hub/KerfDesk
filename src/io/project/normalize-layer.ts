import {
  CNC_CUT_TYPES,
  DEFAULT_CNC_LAYER_SETTINGS,
  DITHER_ALGORITHMS,
  LAYER_DEFAULTS,
  captureLayerOperationSettings,
  type LayerOperationSettings,
} from '../../core/scene';

export function normalizeLayer(layer: unknown): unknown {
  if (!isObject(layer)) return layer;
  const out: Record<string, unknown> = { ...layer };
  normalizeCommonLayerFields(out);
  normalizeFillLayerFields(out);
  normalizeImageLayerFields(out);
  normalizeCncLayerField(out);
  normalizeSubLayers(out);
  return out;
}

// Optional CNC operation block. Absent stays absent (defaults apply at
// compile time); present-but-malformed values fall back field-by-field so a
// hand-edited .lf2 can't smuggle a zero feed or bogus cut type into the
// pipeline.
function normalizeCncLayerField(out: Record<string, unknown>): void {
  const raw = out['cnc'];
  if (raw === undefined) return;
  if (!isObject(raw)) {
    delete out['cnc'];
    return;
  }
  const d = DEFAULT_CNC_LAYER_SETTINGS;
  out['cnc'] = {
    cutType: CNC_CUT_TYPES.some((cutType) => cutType === raw['cutType'])
      ? raw['cutType']
      : d.cutType,
    depthMm: positiveOr(raw['depthMm'], d.depthMm),
    depthPerPassMm: positiveOr(raw['depthPerPassMm'], d.depthPerPassMm),
    // 0 = auto ring spacing (H.3), so non-negative rather than positive.
    vResolutionMm: isNonNegativeNumber(raw['vResolutionMm'])
      ? raw['vResolutionMm']
      : d.vResolutionMm,
    feedMmPerMin: positiveOr(raw['feedMmPerMin'], d.feedMmPerMin),
    plungeMmPerMin: positiveOr(raw['plungeMmPerMin'], d.plungeMmPerMin),
    spindleRpm: positiveOr(raw['spindleRpm'], d.spindleRpm),
    stepoverPercent: positiveOr(raw['stepoverPercent'], d.stepoverPercent),
    tabsEnabled: typeof raw['tabsEnabled'] === 'boolean' ? raw['tabsEnabled'] : d.tabsEnabled,
    tabHeightMm: positiveOr(raw['tabHeightMm'], d.tabHeightMm),
    tabWidthMm: positiveOr(raw['tabWidthMm'], d.tabWidthMm),
    tabsPerShape: isPositiveInteger(raw['tabsPerShape']) ? raw['tabsPerShape'] : d.tabsPerShape,
  };
}

function positiveOr(value: unknown, fallback: number): number {
  return isPositiveNumber(value) ? value : fallback;
}

function normalizeCommonLayerFields(out: Record<string, unknown>): void {
  if (typeof out['airAssist'] !== 'boolean') {
    out['airAssist'] = LAYER_DEFAULTS.airAssist;
  }
  if (typeof out['kerfOffsetMm'] !== 'number' || !Number.isFinite(out['kerfOffsetMm'])) {
    out['kerfOffsetMm'] = LAYER_DEFAULTS.kerfOffsetMm;
  }
  if (typeof out['tabsEnabled'] !== 'boolean') {
    out['tabsEnabled'] = LAYER_DEFAULTS.tabsEnabled;
  }
  if (!isPositiveNumber(out['tabSizeMm'])) {
    out['tabSizeMm'] = LAYER_DEFAULTS.tabSizeMm;
  }
  if (!isPositiveInteger(out['tabsPerShape'])) {
    out['tabsPerShape'] = LAYER_DEFAULTS.tabsPerShape;
  }
  if (typeof out['tabSkipInnerShapes'] !== 'boolean') {
    out['tabSkipInnerShapes'] = LAYER_DEFAULTS.tabSkipInnerShapes;
  }
}

function normalizeFillLayerFields(out: Record<string, unknown>): void {
  if (
    out['fillStyle'] !== 'offset' &&
    out['fillStyle'] !== 'island' &&
    out['fillStyle'] !== 'scanline'
  ) {
    out['fillStyle'] = LAYER_DEFAULTS.fillStyle;
  }
  if (typeof out['hatchAngleDeg'] !== 'number') {
    out['hatchAngleDeg'] = LAYER_DEFAULTS.hatchAngleDeg;
  }
  if (!isPositiveNumber(out['hatchSpacingMm'])) {
    out['hatchSpacingMm'] = LAYER_DEFAULTS.hatchSpacingMm;
  }
  if (!isNonNegativeNumber(out['fillOverscanMm'])) {
    out['fillOverscanMm'] = LAYER_DEFAULTS.fillOverscanMm;
  }
  if (typeof out['fillBidirectional'] !== 'boolean') {
    out['fillBidirectional'] = LAYER_DEFAULTS.fillBidirectional;
  }
  if (typeof out['fillCrossHatch'] !== 'boolean') {
    out['fillCrossHatch'] = LAYER_DEFAULTS.fillCrossHatch;
  }
}

function normalizeImageLayerFields(out: Record<string, unknown>): void {
  if (!DITHER_ALGORITHMS.some((algorithm) => algorithm === out['ditherAlgorithm'])) {
    out['ditherAlgorithm'] = LAYER_DEFAULTS.ditherAlgorithm;
  }
  if (!isPositiveNumber(out['linesPerMm'])) {
    out['linesPerMm'] = LAYER_DEFAULTS.linesPerMm;
  }
  if (!isPercent(out['minPower'])) {
    out['minPower'] = LAYER_DEFAULTS.minPower;
  }
  if (typeof out['imageBidirectional'] !== 'boolean') {
    out['imageBidirectional'] = LAYER_DEFAULTS.imageBidirectional;
  }
  if (typeof out['negativeImage'] !== 'boolean') {
    out['negativeImage'] = LAYER_DEFAULTS.negativeImage;
  }
  if (typeof out['passThrough'] !== 'boolean') {
    out['passThrough'] = LAYER_DEFAULTS.passThrough;
  }
  if (!isNonNegativeNumber(out['dotWidthCorrectionMm'])) {
    out['dotWidthCorrectionMm'] = LAYER_DEFAULTS.dotWidthCorrectionMm;
  }
}

function normalizeSubLayers(out: Record<string, unknown>): void {
  if (!Array.isArray(out['subLayers'])) {
    out['subLayers'] = LAYER_DEFAULTS.subLayers;
    return;
  }
  out['subLayers'] = out['subLayers'].map((value, index) =>
    normalizeSubLayer(value, `Sub-layer ${index + 1}`),
  );
}

function normalizeSubLayer(value: unknown, fallbackLabel: string): unknown {
  if (!isObject(value)) return value;
  return {
    ...value,
    settings: normalizeLayerOperationSettings(value['settings']),
    label: typeof value['label'] === 'string' ? value['label'] : fallbackLabel,
    enabled: typeof value['enabled'] === 'boolean' ? value['enabled'] : true,
  };
}

function normalizeLayerOperationSettings(value: unknown): LayerOperationSettings {
  const settings: Record<string, unknown> = {
    ...captureLayerOperationSettings(LAYER_DEFAULTS),
    ...(isObject(value) ? value : {}),
  };
  normalizeCommonLayerFields(settings);
  normalizeFillLayerFields(settings);
  normalizeImageLayerFields(settings);
  return settings as unknown as LayerOperationSettings;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && value > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isPercent(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 100;
}
