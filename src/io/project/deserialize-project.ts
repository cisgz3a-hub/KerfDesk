// deserializeProject — parses a .lf2 string and returns a typed Project, or a
// structured error describing why it can't be loaded.
//
// Phase A scope: PROJECT_SCHEMA_VERSION = 1; older versions can't exist yet,
// newer versions trigger WORKFLOW.md F-A12 "schema-too-new" modal. Shape
// validation in Phase A is "trust the file was ours" — Zod-style schema
// validation is a Phase B improvement.

import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { LAYER_DEFAULTS, PROJECT_SCHEMA_VERSION, type Project } from '../../core/scene';
import { DEFAULT_TEXT_LETTER_SPACING } from '../../core/text';
import { migrateToCurrent } from './migrations';

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
  const shapeError = validateShape(workingRaw);
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
    },
    scene: {
      ...scene,
      objects: objects.map(normalizeSceneObject),
      layers: layers.map(normalizeLayer),
    },
  };
  return normalized as unknown as Project;
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
  if (typeof out['hatchAngleDeg'] !== 'number') {
    out['hatchAngleDeg'] = LAYER_DEFAULTS.hatchAngleDeg;
  }
  if (typeof out['hatchSpacingMm'] !== 'number') {
    out['hatchSpacingMm'] = LAYER_DEFAULTS.hatchSpacingMm;
  }
  // F.2.e: back-fill image-mode Layer fields. Same additive-with-
  // default pattern as the hatch fields above — pre-F.2 .lf2 files
  // don't have them; treating missing as the default keeps the
  // schema additive (no schemaVersion bump).
  if (
    out['ditherAlgorithm'] !== 'threshold' &&
    out['ditherAlgorithm'] !== 'floyd-steinberg' &&
    out['ditherAlgorithm'] !== 'grayscale'
  ) {
    out['ditherAlgorithm'] = LAYER_DEFAULTS.ditherAlgorithm;
  }
  if (typeof out['linesPerMm'] !== 'number' || out['linesPerMm'] <= 0) {
    out['linesPerMm'] = LAYER_DEFAULTS.linesPerMm;
  }
  return out;
}

function validateShape(raw: Record<string, unknown>): string | null {
  if (!isObject(raw['device'])) return 'missing or invalid `device`';
  if (!isObject(raw['workspace'])) return 'missing or invalid `workspace`';
  const scene = raw['scene'];
  if (!isObject(scene)) return 'missing or invalid `scene`';
  if (!Array.isArray(scene['objects'])) return 'missing or invalid `scene.objects`';
  if (!Array.isArray(scene['layers'])) return 'missing or invalid `scene.layers`';
  return null;
}
