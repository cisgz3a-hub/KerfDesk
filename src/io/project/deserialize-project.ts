// deserializeProject - parses a .lf2 string and returns a typed Project, or a
// structured error describing why it cannot be loaded.

import { normalizeCameraAlignment, normalizeCameraCalibration } from '../../core/camera';
import { isChiploadMaterialKey } from '../../core/cnc';
import {
  DEFAULT_DEVICE_PROFILE,
  isKnownControllerKind,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  normalizeGcodeDialectSelection,
  normalizeGrblRxBufferBytes,
  normalizeGrblStreamingMode,
  normalizeScanOffsetTable,
} from '../../core/devices';
import { normalizeCameraProfile, type CameraProfile } from '../../core/camera';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  type CncCoolantMode,
  type CncTiling,
  DEFAULT_PROJECT_OPTIMIZATION,
  DEFAULT_CNC_TOOLS,
  isCncCoolantMode,
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
  const normalized: Record<string, unknown> = {
    ...raw,
    device: normalizeDevice(dev),
    optimization: normalizeOptimization(raw['optimization']),
    notes: typeof raw['notes'] === 'string' ? raw['notes'] : '',
    scene: {
      ...scene,
      objects: objects.map(normalizeSceneObject),
      layers: layers.map(normalizeLayer),
      groups,
    },
  };
  // `...raw` copied whatever `machine` value the file carried; replace it
  // with the sanitized config, or REMOVE it entirely when unrecognized so an
  // unknown kind can't ride through the spread.
  const machine = normalizeMachineValue(raw['machine']);
  if (machine === undefined) {
    delete normalized['machine'];
  } else {
    normalized['machine'] = machine;
  }
  return normalized as unknown as Project;
}

// Optional machine config (CNC support). Absent or unrecognized → undefined
// (the key is dropped and the project loads as a laser project). A CNC config
// is rebuilt from defaults field-by-field so malformed values cannot reach
// the compiler.
function normalizeMachineValue(raw: unknown): Record<string, unknown> | undefined {
  if (!isObject(raw)) return undefined;
  if (raw['kind'] === 'laser') return { kind: 'laser' };
  if (raw['kind'] !== 'cnc') return undefined;
  const d = DEFAULT_CNC_MACHINE_CONFIG;
  const stock = isObject(raw['stock']) ? raw['stock'] : {};
  const params = isObject(raw['params']) ? raw['params'] : {};
  const tools = normalizeCncTools(raw['tools']);
  const toolId =
    typeof raw['toolId'] === 'string' && tools.some((tool) => tool['id'] === raw['toolId'])
      ? raw['toolId']
      : d.toolId;
  return {
    kind: 'cnc',
    stock: {
      thicknessMm: positiveNumberOrDefault(stock['thicknessMm'], d.stock.thicknessMm),
      widthMm: positiveNumberOrDefault(stock['widthMm'], d.stock.widthMm),
      heightMm: positiveNumberOrDefault(stock['heightMm'], d.stock.heightMm),
      originOffset: normalizeStockOriginOffset(stock['originOffset'], d.stock.originOffset),
      // ADR-112 project material: keep only a known chipload key; drop stale ones.
      ...(isChiploadMaterialKey(stock['materialKey']) ? { materialKey: stock['materialKey'] } : {}),
    },
    tools,
    toolId,
    params: {
      safeZMm: positiveNumberOrDefault(params['safeZMm'], d.params.safeZMm),
      spindleMaxRpm: positiveNumberOrDefault(params['spindleMaxRpm'], d.params.spindleMaxRpm),
      spindleSpinupSec: nonNegativeNumberOrDefault(
        params['spindleSpinupSec'],
        d.params.spindleSpinupSec,
      ),
      // Machine-wide coolant: keep a valid mode, else 'off'. Always present so
      // a loaded config equals the default config (whose coolant is 'off').
      coolant: coolantModeOrOff(params['coolant']),
      // H.9 park position: optional, any finite mm value.
      ...(isFiniteNumber(params['parkXMm']) ? { parkXMm: params['parkXMm'] } : {}),
      ...(isFiniteNumber(params['parkYMm']) ? { parkYMm: params['parkYMm'] } : {}),
    },
    ...normalizeCncTiling(raw['tiling']),
  };
}

// H.10 tiling block: optional; malformed fields drop the whole block (a
// half-valid tiling config must never silently split a job wrong).
function normalizeCncTiling(raw: unknown): { tiling: CncTiling } | Record<string, never> {
  if (!isObject(raw)) return {};
  const tileWidthMm = raw['tileWidthMm'];
  const tileHeightMm = raw['tileHeightMm'];
  const overlapMm = raw['overlapMm'];
  if (!isFiniteNumber(tileWidthMm) || tileWidthMm <= 0) return {};
  if (!isFiniteNumber(tileHeightMm) || tileHeightMm <= 0) return {};
  if (
    !isFiniteNumber(overlapMm) ||
    overlapMm < 0 ||
    overlapMm >= Math.min(tileWidthMm, tileHeightMm)
  ) {
    return {};
  }
  return {
    tiling: {
      tileWidthMm,
      tileHeightMm,
      overlapMm,
      registrationHoles: raw['registrationHoles'] === true,
    },
  };
}

// Stock placement may legitimately be anywhere on (or partially off) the bed
// origin side, so any finite pair is accepted; anything else reverts to the
// default corner.
function normalizeStockOriginOffset(
  raw: unknown,
  fallback: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  if (!isObject(raw)) return { ...fallback };
  const x = raw['x'];
  const y = raw['y'];
  if (typeof x !== 'number' || !Number.isFinite(x)) return { ...fallback };
  if (typeof y !== 'number' || !Number.isFinite(y)) return { ...fallback };
  return { x, y };
}

function normalizeCncTools(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return DEFAULT_CNC_TOOLS.map((tool) => ({ ...tool }));
  const tools = raw.filter(
    (tool): tool is Record<string, unknown> =>
      isObject(tool) &&
      typeof tool['id'] === 'string' &&
      typeof tool['name'] === 'string' &&
      typeof tool['diameterMm'] === 'number' &&
      tool['diameterMm'] > 0,
  );
  return tools.length > 0 ? tools : DEFAULT_CNC_TOOLS.map((tool) => ({ ...tool }));
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
    streamingMode: normalizeGrblStreamingMode(dev['streamingMode']),
    rxBufferBytes: normalizeGrblRxBufferBytes(dev['rxBufferBytes']),
    gcodeDialect: normalizeGcodeDialectSelection(dev['gcodeDialect']),
    scanningOffsets: normalizeScanOffsetTable(dev['scanningOffsets']),
    // Override (not merge) the raw value so a malformed persisted calibration is
    // dropped to undefined rather than trusted; JSON.stringify omits the undefined.
    cameraCalibration: normalizeCameraCalibration(dev['cameraCalibration']),
    cameraAlignment: normalizeCameraAlignment(dev['cameraAlignment']),
    noGoZones: Array.isArray(dev['noGoZones']) ? dev['noGoZones'] : [],
    ...(dev['cameraProfile'] !== undefined
      ? { cameraProfile: normalizeCameraProfile(dev['cameraProfile'] as CameraProfile) }
      : {}),
    ...normalizeZTravelPatch(dev),
    ...normalizeControllerPatch(dev),
  };
}

// ADR-094: a corrupt/unknown controllerKind must never reach
// selectControllerDriver (its switch is exhaustive over the union, so junk
// would return undefined at runtime). Drop invalid values back to the GRBL
// default; same for a non-positive baud rate.
function normalizeControllerPatch(dev: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (dev['controllerKind'] !== undefined && !isKnownControllerKind(dev['controllerKind'])) {
    patch['controllerKind'] = undefined;
  }
  const baud = dev['baudRate'];
  if (baud !== undefined && !(typeof baud === 'number' && Number.isFinite(baud) && baud > 0)) {
    patch['baudRate'] = undefined;
  }
  return patch;
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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
  // Number.isFinite rejects Infinity/NaN — a JSON `1e999` parses to Infinity and
  // would otherwise ride through into emitted G-code (e.g. "G0 ZInfinity").
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

// A valid coolant mode survives; anything else (absent, junk, a legacy pre-
// coolant project) resolves to 'off' — the type's "absent means off" contract.
function coolantModeOrOff(value: unknown): CncCoolantMode {
  return isCncCoolantMode(value) ? value : 'off';
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
