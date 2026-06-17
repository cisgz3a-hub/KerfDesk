// deserializeProject — parses a .lf2 string and returns a typed Project, or a
// structured error describing why it can't be loaded.
//
// Phase A scope: PROJECT_SCHEMA_VERSION = 1; older versions can't exist yet,
// newer versions trigger WORKFLOW.md F-A12 "schema-too-new" modal. Shape
// validation in Phase A is "trust the file was ours" — Zod-style schema
// validation is a Phase B improvement.

import {
  DEFAULT_DEVICE_PROFILE,
  normalizeGcodeDialectSelection,
  normalizeScanOffsetTable,
} from '../../core/devices';
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
    device: {
      ...dev,
      accelMmPerSec2:
        typeof dev['accelMmPerSec2'] === 'number'
          ? dev['accelMmPerSec2']
          : DEFAULT_DEVICE_PROFILE.accelMmPerSec2,
      junctionDeviationMm:
        typeof dev['junctionDeviationMm'] === 'number'
          ? dev['junctionDeviationMm']
          : DEFAULT_DEVICE_PROFILE.junctionDeviationMm,
      // Back-fill for pre-framing-feed .lf2 files. Same additive-with-
      // default pattern as accel / junctionDeviation above.
      framingFeedMmPerMin:
        typeof dev['framingFeedMmPerMin'] === 'number' && dev['framingFeedMmPerMin'] > 0
          ? dev['framingFeedMmPerMin']
          : DEFAULT_DEVICE_PROFILE.framingFeedMmPerMin,
      minPowerS:
        typeof dev['minPowerS'] === 'number' && dev['minPowerS'] >= 0
          ? dev['minPowerS']
          : DEFAULT_DEVICE_PROFILE.minPowerS,
      laserModeEnabled:
        typeof dev['laserModeEnabled'] === 'boolean'
          ? dev['laserModeEnabled']
          : DEFAULT_DEVICE_PROFILE.laserModeEnabled,
      airAssistCommand: normalizeAirAssistCommand(dev['airAssistCommand']),
      gcodeDialect: normalizeGcodeDialectSelection(dev['gcodeDialect']),
      scanningOffsets: normalizeScanOffsetTable(dev['scanningOffsets']),
      noGoZones: Array.isArray(dev['noGoZones']) ? dev['noGoZones'] : [],
    },
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
}

function normalizeFillLayerFields(out: Record<string, unknown>): void {
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

function isPercent(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 100;
}
