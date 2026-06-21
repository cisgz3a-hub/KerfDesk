// deserializeProject - parses a .lf2 string and returns a typed Project, or a
// structured error describing why it cannot be loaded.

import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  normalizeGcodeDialectSelection,
  normalizeScanOffsetTable,
} from '../../core/devices';
import {
  DEFAULT_PROJECT_OPTIMIZATION,
  PROJECT_SCHEMA_VERSION,
  type Project,
} from '../../core/scene';
import { DEFAULT_TEXT_LETTER_SPACING } from '../../core/text';
import { migrateToCurrent } from './migrations';
import { normalizeLayer } from './normalize-layer';
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

  const shapeError = validateProjectShape(workingRaw);
  if (shapeError !== null) return { kind: 'invalid', reason: shapeError };

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
  const groups = Array.isArray(scene['groups']) ? scene['groups'] : [];
  const normalized = {
    ...raw,
    device: normalizeDevice(dev),
    optimization: normalizeOptimization(raw['optimization']),
    scene: {
      ...scene,
      objects: objects.map(normalizeSceneObject),
      layers: layers.map(normalizeLayer),
      groups,
    },
  };
  return normalized as unknown as Project;
}

function normalizeDevice(dev: Record<string, unknown>): Record<string, unknown> {
  return {
    ...dev,
    accelMmPerSec2: numberOrDefault(dev['accelMmPerSec2'], DEFAULT_DEVICE_PROFILE.accelMmPerSec2),
    junctionDeviationMm: numberOrDefault(
      dev['junctionDeviationMm'],
      DEFAULT_DEVICE_PROFILE.junctionDeviationMm,
    ),
    framingFeedMmPerMin: normalizeFramingFeed(dev),
    minPowerS: nonNegativeNumberOrDefault(dev['minPowerS'], DEFAULT_DEVICE_PROFILE.minPowerS),
    laserModeEnabled: booleanOrDefault(
      dev['laserModeEnabled'],
      DEFAULT_DEVICE_PROFILE.laserModeEnabled,
    ),
    airAssistCommand: normalizeAirAssistCommand(dev['airAssistCommand']),
    gcodeDialect: normalizeGcodeDialectSelection(dev['gcodeDialect']),
    scanningOffsets: normalizeScanOffsetTable(dev['scanningOffsets']),
    noGoZones: Array.isArray(dev['noGoZones']) ? dev['noGoZones'] : [],
    ...normalizeZTravelPatch(dev),
  };
}

function normalizeZTravelPatch(dev: Record<string, unknown>): Record<string, unknown> {
  if (dev['zTravelConfirmed'] === undefined) return {};
  const zTravelMm = dev['zTravelMm'];
  const zTravelReady = typeof zTravelMm === 'number' && Number.isFinite(zTravelMm) && zTravelMm > 0;
  const zAxisReady = hasCapability(dev, 'z-axis');
  return { zTravelConfirmed: dev['zTravelConfirmed'] === true && zTravelReady && zAxisReady };
}

function hasCapability(dev: Record<string, unknown>, capability: string): boolean {
  const capabilities = dev['capabilities'];
  return Array.isArray(capabilities) && capabilities.includes(capability);
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function normalizeFramingFeed(dev: Record<string, unknown>): number {
  const raw = positiveNumberOrDefault(
    dev['framingFeedMmPerMin'],
    DEFAULT_DEVICE_PROFILE.framingFeedMmPerMin,
  );
  if (isLegacyNeotronicsFrameFeed(dev, raw)) {
    return NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.framingFeedMmPerMin;
  }
  return raw;
}

function isLegacyNeotronicsFrameFeed(dev: Record<string, unknown>, feed: number): boolean {
  const isNeotronics =
    dev['profileId'] === NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.profileId ||
    dev['machineFamily'] === NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.machineFamily;
  return isNeotronics && feed === DEFAULT_DEVICE_PROFILE.framingFeedMmPerMin;
}

function positiveNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && value > 0 ? value : fallback;
}

function nonNegativeNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && value >= 0 ? value : fallback;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
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

function normalizeSceneObject(obj: unknown): unknown {
  if (!isObject(obj)) return obj;
  if (obj['kind'] !== 'text') return obj;
  if (typeof obj['letterSpacing'] === 'number') return obj;
  return { ...obj, letterSpacing: DEFAULT_TEXT_LETTER_SPACING };
}
