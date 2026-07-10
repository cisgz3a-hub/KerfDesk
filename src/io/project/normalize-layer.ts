import { isChiploadMaterialKey } from '../../core/cnc';
import {
  CNC_CUT_TYPES,
  DEFAULT_CNC_LAYER_SETTINGS,
  DITHER_ALGORITHMS,
  LAYER_DEFAULTS,
  captureLayerOperationSettings,
  type LayerOperationSettings,
} from '../../core/scene';

const POCKET_STRATEGIES = new Set<string>(['offset', 'raster-x', 'raster-y']);

// Keep a raw string field only when it is one of a known set of values —
// used for the closed-union optional CNC layer keys.
function enumPassthrough(
  key: string,
  value: unknown,
  allowed: ReadonlySet<string>,
): Record<string, unknown> {
  return typeof value === 'string' && allowed.has(value) ? { [key]: value } : {};
}

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
    ...optionalCncLayerFields(raw),
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

// The H.7 multi-tool + H.8 finishing + H.9 polish fields, all optional:
// stale/unknown bit ids are kept (they resolve to the machine bit at
// compile time via layerCncTool); malformed values are dropped.
function optionalCncLayerFields(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(typeof raw['toolId'] === 'string' ? { toolId: raw['toolId'] } : {}),
    ...enumPassthrough('pocketStrategy', raw['pocketStrategy'], POCKET_STRATEGIES),
    ...(isChiploadMaterialKey(raw['materialKey']) ? { materialKey: raw['materialKey'] } : {}),
    ...(typeof raw['vClearToolId'] === 'string' ? { vClearToolId: raw['vClearToolId'] } : {}),
    ...(typeof raw['reliefFinishToolId'] === 'string'
      ? { reliefFinishToolId: raw['reliefFinishToolId'] }
      : {}),
    ...(isPositiveNumber(raw['reliefScallopMm'])
      ? { reliefScallopMm: raw['reliefScallopMm'] }
      : {}),
    ...(isPositiveNumber(raw['rampEntryDeg']) ? { rampEntryDeg: raw['rampEntryDeg'] } : {}),
    ...(raw['cutDirection'] === 'climb' || raw['cutDirection'] === 'conventional'
      ? { cutDirection: raw['cutDirection'] }
      : {}),
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
  // Number.isFinite rejects Infinity/NaN (JSON `1e999` → Infinity) so a corrupt
  // CNC-layer numeric cannot ride through normalization into emitted G-code.
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isPercent(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 100;
}
