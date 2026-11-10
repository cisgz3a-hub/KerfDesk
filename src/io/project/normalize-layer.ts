import { normalizeCncReliefAuthoringSettings } from './project-cnc-relief-authoring-settings';
import { normalizeCncPocketRestStock } from '../../core/cnc/cnc-pocket-rest-stock-settings';
import { normalizeCncTaperedInlay } from '../../core/cnc/tapered-inlay-settings';
import { normalizeCncCuttingPreset } from '../../core/cnc/cutting-preset-normalize';
import { isChiploadMaterialKey } from '../../core/cnc';
import {
  CNC_CUT_TYPES,
  DEFAULT_CNC_LAYER_SETTINGS,
  DITHER_ALGORITHMS,
  LAYER_DEFAULTS,
  captureLayerOperationSettings,
  type LayerOperationSettings,
} from '../../core/scene';
import { normalizeCncFeedSource } from './normalize-cnc-feed-source';
import { isRecord } from '../../core/util/is-record';
import {
  isNonNegativeFiniteNumber,
  isPositiveFiniteNumber,
  isPositiveInteger,
} from '../../core/util/finite';

const POCKET_STRATEGIES = new Set<string>(['offset', 'raster-x', 'raster-y', 'adaptive']);
const LINE_ART_CONTOUR_SIDES = new Set<string>(['inner', 'outer', 'both']);
const RELIEF_FINISH_STRATEGIES = new Set<string>(['raster', 'raster-waterline']);
const RELIEF_RASTER_AXES = new Set<string>(['x', 'y']);
const RELIEF_FLAT_FINISHES = new Set<string>(['finishing-bit', 'roughing-bit']);
const PROFILE_LEAD_SHAPES = new Set<string>(['arc', 'line', 'none']);

// Keep a raw string field only when it is one of a known set of values —
// used for the closed-union optional CNC layer keys.
function enumPassthrough(
  key: string,
  value: unknown,
  allowed: ReadonlySet<string>,
): Record<string, unknown> {
  return typeof value === 'string' && allowed.has(value) ? { [key]: value } : {};
}

// Keep an optional boolean field only when it is actually a boolean; anything
// else is dropped so the compile default applies by omission.
function booleanPassthrough(key: string, value: unknown): Record<string, unknown> {
  return typeof value === 'boolean' ? { [key]: value } : {};
}

function positiveNumberPassthrough(key: string, value: unknown): Record<string, unknown> {
  return isPositiveFiniteNumber(value) ? { [key]: value } : {};
}

export function normalizeLayer(layer: unknown): unknown {
  if (!isRecord(layer)) return layer;
  const out: Record<string, unknown> = { ...layer };
  if (typeof out['name'] !== 'string' || out['name'].trim().length === 0) {
    out['name'] = 'Operation';
  }
  normalizeCommonLayerFields(out);
  normalizeScanMotionOverrides(out);
  normalizeScanOffsetCalibrationMode(out);
  normalizeFillLayerFields(out);
  normalizeImageLayerFields(out);
  normalizeCncLayerField(out);
  normalizeSubLayers(out);
  return out;
}

function normalizeScanOffsetCalibrationMode(out: Record<string, unknown>): void {
  if (
    out['scanOffsetCalibrationMode'] !== 'baseline' &&
    out['scanOffsetCalibrationMode'] !== 'verification'
  ) {
    delete out['scanOffsetCalibrationMode'];
  }
}

function normalizeScanMotionOverrides(out: Record<string, unknown>): void {
  if (typeof out['allowUncalibratedBidirectionalScan'] !== 'boolean') {
    delete out['allowUncalibratedBidirectionalScan'];
  }
  if (
    typeof out['bidirectionalScanOffsetMm'] !== 'number' ||
    !Number.isFinite(out['bidirectionalScanOffsetMm'])
  ) {
    delete out['bidirectionalScanOffsetMm'];
  }
}

// Optional CNC operation block. Absent stays absent (defaults apply at
// compile time); present-but-malformed values fall back field-by-field so a
// hand-edited .lf2 can't smuggle a zero feed or bogus cut type into the
// pipeline.
function normalizeCncLayerField(out: Record<string, unknown>): void {
  const raw = out['cnc'];
  if (raw === undefined) return;
  if (!isRecord(raw)) {
    delete out['cnc'];
    return;
  }
  const d = DEFAULT_CNC_LAYER_SETTINGS;
  out['cnc'] = {
    cutType: CNC_CUT_TYPES.some((cutType) => cutType === raw['cutType'])
      ? raw['cutType']
      : d.cutType,
    ...optionalCncLayerFields(raw),
    ...(normalizeCncPocketRestStock(raw['pocketRestStock']) === undefined
      ? {}
      : { pocketRestStock: normalizeCncPocketRestStock(raw['pocketRestStock']) }),
    ...normalizeCncReliefAuthoringSettings(raw),
    ...(normalizeCncTaperedInlay(raw['taperedInlay']) === undefined
      ? {}
      : { taperedInlay: normalizeCncTaperedInlay(raw['taperedInlay']) }),
    // Validated as an intact physical recipe before normalization.
    ...(raw['stageRecipes'] === undefined
      ? {}
      : { stageRecipes: normalizeStagePresetSnapshots(raw['stageRecipes']) }),
    depthMm: positiveOr(raw['depthMm'], d.depthMm),
    depthPerPassMm: positiveOr(raw['depthPerPassMm'], d.depthPerPassMm),
    // 0 = automatic medial sampling and flat-core pitch (H.3).
    vResolutionMm: isNonNegativeFiniteNumber(raw['vResolutionMm'])
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
    ...(isPositiveFiniteNumber(raw['adaptiveOptimalLoadMm'])
      ? { adaptiveOptimalLoadMm: raw['adaptiveOptimalLoadMm'] }
      : {}),
    ...normalizeInlayFields(raw),
    ...(isChiploadMaterialKey(raw['materialKey']) ? { materialKey: raw['materialKey'] } : {}),
    ...optionalCncFeedSource(raw),
    ...optionalCncCuttingPreset(raw),
    ...(typeof raw['vClearToolId'] === 'string' ? { vClearToolId: raw['vClearToolId'] } : {}),
    ...(typeof raw['pocketRoughToolId'] === 'string'
      ? { pocketRoughToolId: raw['pocketRoughToolId'] }
      : {}),
    ...(typeof raw['reliefFinishToolId'] === 'string'
      ? { reliefFinishToolId: raw['reliefFinishToolId'] }
      : {}),
    ...(isPositiveFiniteNumber(raw['reliefScallopMm'])
      ? { reliefScallopMm: raw['reliefScallopMm'] }
      : {}),
    ...enumPassthrough(
      'reliefFinishStrategy',
      raw['reliefFinishStrategy'],
      RELIEF_FINISH_STRATEGIES,
    ),
    ...enumPassthrough('reliefRasterAxis', raw['reliefRasterAxis'], RELIEF_RASTER_AXES),
    ...positiveNumberPassthrough('reliefFineStepMm', raw['reliefFineStepMm']),
    ...enumPassthrough('reliefFlatFinish', raw['reliefFlatFinish'], RELIEF_FLAT_FINISHES),
    ...(isPositiveFiniteNumber(raw['rampEntryDeg']) ? { rampEntryDeg: raw['rampEntryDeg'] } : {}),
    ...positiveNumberPassthrough('vCarveRampEntryDeg', raw['vCarveRampEntryDeg']),
    ...booleanPassthrough('vCarveFlatDepthEnabled', raw['vCarveFlatDepthEnabled']),
    ...normalizeHelixEntry(raw['helixEntry']),
    ...(raw['cutDirection'] === 'climb' || raw['cutDirection'] === 'conventional'
      ? { cutDirection: raw['cutDirection'] }
      : {}),
    // ADR-253 retract-between-passes (per-layer boolean, default-on at compile
    // for eligible cuts). Persisted so an operator's explicit OFF survives a
    // save/load — absent stays absent and reads as the compile default.
    ...booleanPassthrough('retractBetweenPasses', raw['retractBetweenPasses']),
    ...booleanPassthrough('pocketLiftBetweenRings', raw['pocketLiftBetweenRings']),
    // Finish allowance: non-negative (0 = off), so a hand-edited negative value
    // is dropped rather than inflating the roughing offset the wrong way.
    ...(isNonNegativeFiniteNumber(raw['finishAllowanceMm'])
      ? { finishAllowanceMm: raw['finishAllowanceMm'] }
      : {}),
    // ADR-218 traced double-line side; unknown values are dropped so the
    // compile default ('inner') applies by omission.
    ...enumPassthrough('lineArtContours', raw['lineArtContours'], LINE_ART_CONTOUR_SIDES),
    // ADR-250 profile lead-in/out. An unknown shape drops the whole block so the
    // default-on tool-radius arc applies by omission; malformed radius/sweep are
    // dropped field-by-field, matching every other optional CNC setting.
    ...normalizeProfileLead(raw['profileLead']),
  };
}

function normalizeProfileLead(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const shape = value['shape'];
  if (typeof shape !== 'string' || !PROFILE_LEAD_SHAPES.has(shape)) return {};
  return {
    profileLead: {
      shape,
      ...(isPositiveFiniteNumber(value['radiusMm']) ? { radiusMm: value['radiusMm'] } : {}),
      ...(isPositiveFiniteNumber(value['sweepDeg']) ? { sweepDeg: value['sweepDeg'] } : {}),
    },
  };
}

function optionalCncFeedSource(raw: Record<string, unknown>): Record<string, unknown> {
  const feedSource = normalizeCncFeedSource(raw['feedSource'], raw['materialKey']);
  return feedSource === undefined ? {} : { feedSource };
}

function normalizeStagePresetSnapshots(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, stage]) => {
      if (!isRecord(stage)) return [key, stage];
      const { cuttingPreset: _preset, ...settings } = stage;
      return [key, { ...settings, ...optionalCncCuttingPreset(stage) }];
    }),
  );
}

function optionalCncCuttingPreset(raw: Record<string, unknown>): Record<string, unknown> {
  const cuttingPreset = normalizeCncCuttingPreset(raw['cuttingPreset']);
  return cuttingPreset === null ? {} : { cuttingPreset };
}

function normalizeInlayFields(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(isPositiveFiniteNumber(raw['inlayPocketDepthMm'])
      ? { inlayPocketDepthMm: raw['inlayPocketDepthMm'] }
      : {}),
    ...(isNonNegativeFiniteNumber(raw['inlayAllowanceMm'])
      ? { inlayAllowanceMm: raw['inlayAllowanceMm'] }
      : {}),
    ...(isPositiveFiniteNumber(raw['inlayPairSpacingMm'])
      ? { inlayPairSpacingMm: raw['inlayPairSpacingMm'] }
      : {}),
  };
}

function normalizeHelixEntry(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  if (
    !isPositiveFiniteNumber(value['maxDiameterMm']) ||
    !isPositiveFiniteNumber(value['minDiameterMm']) ||
    !isPositiveFiniteNumber(value['angleDeg']) ||
    value['minDiameterMm'] > value['maxDiameterMm']
  ) {
    return {};
  }
  return {
    helixEntry: {
      maxDiameterMm: value['maxDiameterMm'],
      minDiameterMm: value['minDiameterMm'],
      angleDeg: value['angleDeg'],
    },
  };
}

function positiveOr(value: unknown, fallback: number): number {
  return isPositiveFiniteNumber(value) ? value : fallback;
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
  if (!isPositiveFiniteNumber(out['tabSizeMm'])) {
    out['tabSizeMm'] = LAYER_DEFAULTS.tabSizeMm;
  }
  if (!isPositiveInteger(out['tabsPerShape'])) {
    out['tabsPerShape'] = LAYER_DEFAULTS.tabsPerShape;
  }
  if (typeof out['tabSkipInnerShapes'] !== 'boolean') {
    out['tabSkipInnerShapes'] = LAYER_DEFAULTS.tabSkipInnerShapes;
  }
  normalizeTabLayoutFields(out);
  normalizeLeadFields(out);
}

// ADR-494: the optional tab layout and tab power stay absent (tabs by count,
// uncut) unless they hold a usable value, like the ADR-415 settings.
function normalizeTabLayoutFields(out: Record<string, unknown>): void {
  if (out['tabLayout'] !== 'count' && out['tabLayout'] !== 'spacing') delete out['tabLayout'];
  if (!isPositiveFiniteNumber(out['tabSpacingMm'])) delete out['tabSpacingMm'];
  const maxPerShape = out['tabMaxPerShape'];
  if (!isNonNegativeFiniteNumber(maxPerShape) || !Number.isInteger(maxPerShape)) {
    delete out['tabMaxPerShape'];
  }
  const power = out['tabCutPowerPercent'];
  if (!isNonNegativeFiniteNumber(power) || power > 100) delete out['tabCutPowerPercent'];
}

// ADR-626: the optional lead settings stay absent (no leads) unless they
// hold a usable value, like the tab settings above.
function normalizeLeadFields(out: Record<string, unknown>): void {
  if (typeof out['leadInEnabled'] !== 'boolean') delete out['leadInEnabled'];
  if (typeof out['leadOutEnabled'] !== 'boolean') delete out['leadOutEnabled'];
  if (out['leadStyle'] !== 'arc' && out['leadStyle'] !== 'line') delete out['leadStyle'];
  if (!isPositiveFiniteNumber(out['leadLengthMm'])) delete out['leadLengthMm'];
  const angle = out['leadAngleDeg'];
  if (typeof angle !== 'number' || !Number.isFinite(angle)) delete out['leadAngleDeg'];
  const side = out['leadSide'];
  if (side !== 'auto' && side !== 'outside' && side !== 'inside') delete out['leadSide'];
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
  if (!isPositiveFiniteNumber(out['hatchSpacingMm'])) {
    out['hatchSpacingMm'] = LAYER_DEFAULTS.hatchSpacingMm;
  }
  if (!isNonNegativeFiniteNumber(out['fillOverscanMm'])) {
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
  if (!isPositiveFiniteNumber(out['linesPerMm'])) {
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
  if (!isNonNegativeFiniteNumber(out['dotWidthCorrectionMm'])) {
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
  if (!isRecord(value)) return value;
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
    ...(isRecord(value) ? value : {}),
  };
  normalizeCommonLayerFields(settings);
  normalizeFillLayerFields(settings);
  normalizeImageLayerFields(settings);
  return captureLayerOperationSettings(settings as unknown as LayerOperationSettings);
}

function isPercent(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 100;
}
