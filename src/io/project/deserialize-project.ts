// deserializeProject — parses a .lf2 string and returns a typed Project, or a
// structured error describing why it can't be loaded.
//
// Phase A scope: PROJECT_SCHEMA_VERSION = 1; older versions can't exist yet,
// newer versions trigger WORKFLOW.md F-A12 "schema-too-new" modal. Shape
// validation in Phase A is "trust the file was ours" — Zod-style schema
// validation is a Phase B improvement.

import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import {
  DITHER_ALGORITHMS,
  DEFAULT_PROJECT_OPTIMIZATION,
  LAYER_DEFAULTS,
  PROJECT_SCHEMA_VERSION,
  type Project,
} from '../../core/scene';
import { DEFAULT_TEXT_LETTER_SPACING } from '../../core/text';
import { migrateToCurrent } from './migrations';
import { validateProjectShape } from './project-shape-validator';

export type DeserializeResult =
  | { readonly kind: 'ok'; readonly project: Project; readonly migratedFrom?: number }
  | { readonly kind: 'schema-too-new'; readonly sawVersion: number }
  | { readonly kind: 'schema-too-old'; readonly sawVersion: number }
  | { readonly kind: 'invalid'; readonly reason: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deserializeProject(jsonText: string): DeserializeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'invalid', reason: `not valid JSON: ${message}` };
  }

  if (!isObject(raw)) {
    return { kind: 'invalid', reason: 'top-level value is not an object' };
  }

  const version = raw['schemaVersion'];
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    return { kind: 'invalid', reason: 'missing or non-numeric schemaVersion' };
  }

  if (version > PROJECT_SCHEMA_VERSION) {
    return { kind: 'schema-too-new', sawVersion: version };
  }
  // Migration path (F-A12). Phase A's migration registry is empty so any
  // v<1 file lands in `no-path` here; the moment Phase D/E registers a
  // 0→1 migrator this branch starts succeeding, no other code changes.
  let workingRaw: Record<string, unknown> = raw;
  let migratedFrom: number | undefined;
  if (version < PROJECT_SCHEMA_VERSION) {
    const migrated = migrateToCurrent(raw, version);
    if (migrated.kind === 'no-path') {
      return { kind: 'schema-too-old', sawVersion: version };
    }
    workingRaw = migrated.raw;
    migratedFrom = version;
  }

  // Top-level shape check (audit finding I-5). A `.lf2` with a truncated or
  // hand-edited body must reach the F-A12 "Could not open" modal, not crash
  // deep in the renderer. Field-level validation is a Phase C improvement.
  const shapeError = validateProjectShape(workingRaw);
  if (shapeError !== null) return { kind: 'invalid', reason: shapeError };

  // Normalize additive DeviceProfile fields. Older .lf2 files predate
  // the planner-aware estimator's accelMmPerSec2 / junctionDeviationMm
  // fields. Filling defaults here keeps the type honest and avoids
  // a schemaVersion bump (additive-with-default = no migration needed).
  const project = normalizeProject(workingRaw);

  if (migratedFrom !== undefined) {
    return { kind: 'ok', project, migratedFrom };
  }
  return { kind: 'ok', project };
}

function normalizeProject(raw: Record<string, unknown>): Project {
  const dev = (raw['device'] ?? {}) as Record<string, unknown>;
  const scene = (raw['scene'] ?? {}) as Record<string, unknown>;
  const objects = Array.isArray(scene['objects']) ? scene['objects'] : [];
  const layers = Array.isArray(scene['layers']) ? scene['layers'] : [];
  const normalized = {
    ...raw,
    device: normalizeDevice(dev),
    optimization: normalizeOptimization(raw['optimization']),
    scene: {
      ...scene,
      objects: objects.map(normalizeSceneObject),
      layers: layers.map(normalizeLayer),
    },
  };
  // Cast justification: validateProjectShape (called in deserializeProject
  // before normalize) has already deep-validated every field of device /
  // workspace / optimization / scene / layers / objects — including the
  // bounds-order invariant — and normalizeProject only back-fills additive
  // defaults onto that validated shape. TypeScript can't carry the validator's
  // runtime guarantees across the Record<string, unknown> boundary, so this is
  // the single trusted point. Replacing it with typed builders is tracked as a
  // Phase C improvement (audit CQ-006); the runtime is already validated.
  return normalized as unknown as Project;
}

function normalizeDevice(dev: Record<string, unknown>): Project['device'] {
  const airAssistCommand = normalizeAirAssistCommand(dev['airAssistCommand']);
  return {
    ...dev,
    ...normalizeDeviceProfileMetadata(dev),
    ...normalizeDeviceAdditiveFields(dev),
    airAssistCommand,
    controller: normalizeDeviceController(dev['controller']),
    gcodeDialect: normalizeGcodeDialect(dev['gcodeDialect'], airAssistCommand),
  } as unknown as Project['device'];
}

function normalizeDeviceProfileMetadata(dev: Record<string, unknown>): Record<string, unknown> {
  const noGoZones = normalizeNoGoZones(dev['noGoZones']);
  return {
    profileId: stringOrDefault(
      dev['profileId'],
      DEFAULT_DEVICE_PROFILE.profileId ?? 'generic-grbl-400x400',
    ),
    vendor: stringOrDefault(dev['vendor'], DEFAULT_DEVICE_PROFILE.vendor ?? 'Generic'),
    model: stringOrDefault(
      dev['model'],
      DEFAULT_DEVICE_PROFILE.model ?? DEFAULT_DEVICE_PROFILE.name,
    ),
    profileSource: profileSourceOrDefault(dev['profileSource']),
    catalogVersion: stringOrDefault(
      dev['catalogVersion'],
      DEFAULT_DEVICE_PROFILE.catalogVersion ?? '2026-06-17',
    ),
    capabilities: stringArrayOrDefault(
      dev['capabilities'],
      DEFAULT_DEVICE_PROFILE.capabilities ?? ['grbl'],
    ),
    evidence: Array.isArray(dev['evidence']) ? dev['evidence'] : DEFAULT_DEVICE_PROFILE.evidence,
    ...(noGoZones !== undefined ? { noGoZones } : {}),
  };
}

function normalizeDeviceAdditiveFields(dev: Record<string, unknown>): Record<string, unknown> {
  return {
    accelMmPerSec2: positiveFiniteOrDefault(
      dev['accelMmPerSec2'],
      DEFAULT_DEVICE_PROFILE.accelMmPerSec2,
    ),
    junctionDeviationMm: positiveFiniteOrDefault(
      dev['junctionDeviationMm'],
      DEFAULT_DEVICE_PROFILE.junctionDeviationMm,
    ),
    framingFeedMmPerMin: positiveFiniteOrDefault(
      dev['framingFeedMmPerMin'],
      DEFAULT_DEVICE_PROFILE.framingFeedMmPerMin,
    ),
    minPowerS: nonNegativeFiniteOrDefault(dev['minPowerS'], DEFAULT_DEVICE_PROFILE.minPowerS),
    laserModeEnabled: booleanOrDefault(
      dev['laserModeEnabled'],
      DEFAULT_DEVICE_PROFILE.laserModeEnabled,
    ),
  };
}

function normalizeOptimization(value: unknown): Project['optimization'] {
  if (!isObject(value)) return DEFAULT_PROJECT_OPTIMIZATION;
  return {
    reduceTravelMoves:
      typeof value['reduceTravelMoves'] === 'boolean'
        ? value['reduceTravelMoves']
        : DEFAULT_PROJECT_OPTIMIZATION.reduceTravelMoves,
  };
}

function normalizeAirAssistCommand(value: unknown): Project['device']['airAssistCommand'] {
  return value === 'M7' || value === 'M8' ? value : DEFAULT_DEVICE_PROFILE.airAssistCommand;
}

function normalizeDeviceController(value: unknown): Project['device']['controller'] {
  if (!isObject(value)) return DEFAULT_DEVICE_PROFILE.controller;
  return {
    baudRate: positiveFiniteOrDefault(
      value['baudRate'],
      DEFAULT_DEVICE_PROFILE.controller.baudRate,
    ),
    rxBufferBytes: positiveFiniteOrDefault(
      value['rxBufferBytes'],
      DEFAULT_DEVICE_PROFILE.controller.rxBufferBytes,
    ),
    streamingMode:
      value['streamingMode'] === 'ping-pong' || value['streamingMode'] === 'char-counted'
        ? value['streamingMode']
        : DEFAULT_DEVICE_PROFILE.controller.streamingMode,
    pollDuringJob:
      value['pollDuringJob'] === 'off' ||
      value['pollDuringJob'] === '1hz' ||
      value['pollDuringJob'] === '2hz' ||
      value['pollDuringJob'] === '4hz'
        ? value['pollDuringJob']
        : DEFAULT_DEVICE_PROFILE.controller.pollDuringJob,
    requiresHomingBeforeJob: booleanOrDefault(
      value['requiresHomingBeforeJob'],
      DEFAULT_DEVICE_PROFILE.controller.requiresHomingBeforeJob,
    ),
    supportsStatusBufferReport: booleanOrDefault(
      value['supportsStatusBufferReport'],
      DEFAULT_DEVICE_PROFILE.controller.supportsStatusBufferReport,
    ),
    supportsWcs: booleanOrDefault(
      value['supportsWcs'],
      DEFAULT_DEVICE_PROFILE.controller.supportsWcs,
    ),
    safeModeDefault: booleanOrDefault(
      value['safeModeDefault'],
      DEFAULT_DEVICE_PROFILE.controller.safeModeDefault,
    ),
  };
}

function normalizeGcodeDialect(
  value: unknown,
  airAssistCommand: Project['device']['airAssistCommand'],
): Project['device']['gcodeDialect'] {
  if (!isObject(value)) return { ...DEFAULT_DEVICE_PROFILE.gcodeDialect, airAssistCommand };
  const dialectId =
    typeof value['dialectId'] === 'string' && value['dialectId'].trim() !== ''
      ? value['dialectId']
      : DEFAULT_DEVICE_PROFILE.gcodeDialect.dialectId;
  const controlledLaserOffTravelFeedMmPerMin = controlledLaserOffTravelFeedOrDefault(
    value['controlledLaserOffTravelFeedMmPerMin'],
    dialectId,
  );
  return {
    dialectId,
    returnToOriginOnEnd: booleanOrDefault(
      value['returnToOriginOnEnd'],
      DEFAULT_DEVICE_PROFILE.gcodeDialect.returnToOriginOnEnd,
    ),
    emitSOnTravel: booleanOrDefault(
      value['emitSOnTravel'],
      DEFAULT_DEVICE_PROFILE.gcodeDialect.emitSOnTravel,
    ),
    emitSOnEveryBurnMove: booleanOrDefault(
      value['emitSOnEveryBurnMove'],
      DEFAULT_DEVICE_PROFILE.gcodeDialect.emitSOnEveryBurnMove,
    ),
    modalFeedrate: booleanOrDefault(
      value['modalFeedrate'],
      DEFAULT_DEVICE_PROFILE.gcodeDialect.modalFeedrate,
    ),
    ...(controlledLaserOffTravelFeedMmPerMin !== undefined
      ? { controlledLaserOffTravelFeedMmPerMin }
      : {}),
    airAssistCommand,
    laserModeCommand:
      value['laserModeCommand'] === 'M3' ||
      value['laserModeCommand'] === 'M4' ||
      value['laserModeCommand'] === 'mixed'
        ? value['laserModeCommand']
        : DEFAULT_DEVICE_PROFILE.gcodeDialect.laserModeCommand,
  };
}

function normalizeNoGoZones(value: unknown): Project['device']['noGoZones'] {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isNoGoZone);
}

function isNoGoZone(value: unknown): value is NonNullable<Project['device']['noGoZones']>[number] {
  if (!isObject(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['enabled'] === 'boolean' &&
    isFiniteNumber(value['x']) &&
    isFiniteNumber(value['y']) &&
    isPositiveNumber(value['width']) &&
    isPositiveNumber(value['height'])
  );
}

function profileSourceOrDefault(value: unknown): Project['device']['profileSource'] {
  if (
    value === 'built-in' ||
    value === 'custom' ||
    value === 'imported-lightburn' ||
    value === 'diagnostic'
  ) {
    return value;
  }
  return DEFAULT_DEVICE_PROFILE.profileSource ?? 'built-in';
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

function stringArrayOrDefault(
  value: unknown,
  fallback: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : fallback;
}

function controlledLaserOffTravelFeedOrDefault(
  value: unknown,
  dialectId: string,
): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (dialectId === NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.gcodeDialect.dialectId) {
    return NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.gcodeDialect.controlledLaserOffTravelFeedMmPerMin;
  }
  return DEFAULT_DEVICE_PROFILE.gcodeDialect.controlledLaserOffTravelFeedMmPerMin;
}

function positiveFiniteOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeFiniteOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

// Back-fill additive TextObject fields on load. D.1 added letterSpacing —
// .lf2 files saved before D.1 don't have it. Treating missing as the
// default (0 = natural spacing) keeps the schema additive without forcing
// a schemaVersion bump.
function normalizeSceneObject(obj: unknown): unknown {
  if (!isObject(obj)) return obj;
  if (obj['kind'] !== 'text') return obj;
  if (typeof obj['letterSpacing'] === 'number') return obj;
  return { ...obj, letterSpacing: DEFAULT_TEXT_LETTER_SPACING };
}

// Back-fill F.1 hatch fields on Layer. Pre-F.1 .lf2 files have no
// hatchAngleDeg / hatchSpacingMm — fill with LAYER_DEFAULTS so the
// compile path doesn't see NaN for mode='line' layers and so a future
// flip to mode='fill' has sensible starting values.
function normalizeLayer(layer: unknown): unknown {
  if (!isObject(layer)) return layer;
  const out: Record<string, unknown> = { ...layer };
  normalizeCommonLayerFields(out);
  normalizeFillLayerFields(out);
  normalizeImageLayerFields(out);
  return out;
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
  if (out['fillStyle'] !== 'offset' && out['fillStyle'] !== 'scanline') {
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
  // ADR-038: pre-unidirectional .lf2 files have no fillBidirectional — default
  // to the snake fill they were authored against so reopening is unchanged.
  if (typeof out['fillBidirectional'] !== 'boolean') {
    out['fillBidirectional'] = LAYER_DEFAULTS.fillBidirectional;
  }
  if (typeof out['fillCrossHatch'] !== 'boolean') {
    out['fillCrossHatch'] = LAYER_DEFAULTS.fillCrossHatch;
  }
}

function normalizeImageLayerFields(out: Record<string, unknown>): void {
  // F.2.e: back-fill image-mode Layer fields. Same additive-with-
  // default pattern as the hatch fields above — pre-F.2 .lf2 files
  // don't have them; treating missing as the default keeps the
  // schema additive (no schemaVersion bump).
  if (!DITHER_ALGORITHMS.some((algorithm) => algorithm === out['ditherAlgorithm'])) {
    out['ditherAlgorithm'] = LAYER_DEFAULTS.ditherAlgorithm;
  }
  if (!isPositiveNumber(out['linesPerMm'])) {
    out['linesPerMm'] = LAYER_DEFAULTS.linesPerMm;
  }
  if (!isPercent(out['minPower'])) {
    out['minPower'] = LAYER_DEFAULTS.minPower;
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

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isPercent(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 100;
}
