import { normalizeSceneObject } from './normalize-scene-object';
// deserializeProject - parses a .lf2 string and returns a typed Project, or a
// structured error describing why it cannot be loaded.

import { normalizeCameraModelRecord } from '../../core/camera/model/camera-model-record';
import { normalizeOtherCameraModels } from '../../core/camera/model/saved-cameras';
import { isChiploadMaterialKey } from '../../core/cnc';
import {
  DEFAULT_DEVICE_PROFILE,
  isKnownControllerKind,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  normalizeLaserFireControl,
  normalizeGcodeDialectSelection,
  normalizeGrblRxBufferBytes,
  normalizeGrblStreamingMode,
  normalizeScanOffsetTable,
  streamingModeForController,
} from '../../core/devices';
import { isBidirectionalScanPolicy } from '../../core/devices/device-profile';
import { laserArcMovesEntry } from '../../core/devices/laser-arc-moves';
import { normalizeScanOffsetCalibrationStatus } from '../../core/devices/scan-offset-profile';
import { normalizeCameraProfile, type CameraProfile } from '../../core/camera';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  type CncMachineConfig,
  type CncCoolantMode,
  type CncTiling,
  isCncCoolantMode,
  type Project,
} from '../../core/scene';
import {
  clampOverlapMergeTolerance,
  DEFAULT_PROJECT_OPTIMIZATION,
  PROJECT_SCHEMA_VERSION,
  isLineStartRegion,
} from '../../core/scene/project';
import { migrateToCurrent } from './migrations';
import { normalizeCncTools } from './normalize-cnc-tools';
import { normalizeCncMachiningSetup } from './project-cnc-setup-validator';
import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import { parseProcessRecipeApplications } from './project-process-recipe-validator';
import { parseProductionNestDefinition } from './project-production-nest-validator';
import { normalizeLayer } from './normalize-layer';
import { normalizeTileRegistration } from './normalize-tile-registration';
import { validateProjectShape } from './project-shape-validator';
import { recoveredCncDevicePatch } from './project-cnc-sub-profile-recovery';
import { normalizeProjectJobSetup } from './project-job-setup-normalizer';
import { projectDeviceControllerCompatibleFields } from './project-device-controller-compatibility';
import { normalizeControllerPatch } from './project-controller-normalization';

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

  return deserializeProjectValue(raw);
}

export function deserializeProjectValue(raw: unknown): DeserializeResult {
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
    if (migrated.kind === 'invalid') return migrated;
    workingRaw = migrated.raw;
    migratedFrom = version;
  }

  const shapeError = validateProjectShape(workingRaw);
  if (shapeError !== null) return { kind: 'invalid', reason: shapeError };

  let project: Project;
  try {
    project = normalizeProject(workingRaw);
  } catch (error) {
    return {
      kind: 'invalid',
      reason: error instanceof Error ? error.message : 'Could not normalize project geometry',
    };
  }

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
    jobSetup: normalizeProjectJobSetup(raw['jobSetup']),
    notes: typeof raw['notes'] === 'string' ? raw['notes'] : '',
    scene: {
      ...scene,
      objects: objects.map(normalizeSceneObject),
      layers: layers.map(normalizeLayer),
      groups,
    },
  };
  // `...raw` copied whatever `machine` value the file carried; replace it
  // with the sanitized config. Shape validation has already rejected unknown
  // machine kinds so they cannot silently change a project into a laser job.
  const machine = normalizeMachineValue(raw['machine']);
  if (machine === undefined) {
    delete normalized['machine'];
  } else {
    normalized['machine'] = machine;
  }
  // The CNC setup parked by a Laser-mode save; a CNC project has none.
  const parked =
    machine?.['kind'] === 'cnc' ? null : normalizeCncMachineConfig(raw['parkedCncMachine']);
  if (parked === null) {
    delete normalized['parkedCncMachine'];
  } else {
    normalized['parkedCncMachine'] = parked;
  }
  normalizeCncProductionMetadata(raw, normalized, machine, parked);
  return normalized as unknown as Project;
}

function normalizeCncProductionMetadata(
  raw: Record<string, unknown>,
  normalized: Record<string, unknown>,
  machine: Record<string, unknown> | undefined,
  parked: CncMachineConfig | null,
): void {
  const setup =
    normalizeCncMachiningSetup(raw['cncSetup']) ??
    (machine?.['kind'] === 'cnc' || parked !== null ? defaultCncMachiningSetup() : undefined);
  if (setup === undefined) delete normalized['cncSetup'];
  else normalized['cncSetup'] = setup;
  if (raw['processRecipeApplications'] !== undefined) {
    const applications = parseProcessRecipeApplications(raw['processRecipeApplications']);
    if (applications.kind === 'ok') normalized['processRecipeApplications'] = applications.value;
  }
  const nest = parseProductionNestDefinition(raw['productionNest']);
  if (nest.kind === 'ok' && nest.value !== undefined) normalized['productionNest'] = nest.value;
}

// Optional machine config (CNC support). Absent → undefined. A CNC config
// is rebuilt from defaults field-by-field so malformed values cannot reach
// the compiler; shape validation rejects unrecognized kinds before this runs.
function normalizeMachineValue(raw: unknown): Record<string, unknown> | undefined {
  if (!isObject(raw)) return undefined;
  if (raw['kind'] === 'laser') return { kind: 'laser' };
  return normalizeCncMachineConfig(raw) ?? undefined;
}

export function normalizeCncMachineConfig(raw: unknown): CncMachineConfig | null {
  if (!isObject(raw) || raw['kind'] !== 'cnc') return null;
  const d = DEFAULT_CNC_MACHINE_CONFIG;
  const stock = isObject(raw['stock']) ? raw['stock'] : {};
  const params = isObject(raw['params']) ? raw['params'] : {};
  const tools = normalizeCncTools(raw['tools']);
  const toolId =
    typeof raw['toolId'] === 'string' && tools.some((tool) => tool['id'] === raw['toolId'])
      ? raw['toolId']
      : (tools[0]?.id ?? d.toolId);
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
      // ADR-491 park height above the stock top; absent = safe Z.
      ...positiveField(params, 'parkZMm'),
      // CNC's own Max feed and Frame speed; absent = the shared device values.
      ...positiveField(params, 'maxFeedMmPerMin'),
      ...positiveField(params, 'framingFeedMmPerMin'),
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
  // Overlap is checked for shape only, not against the tile size. The panel
  // clamps tile width/height and overlap independently with no cross-field
  // check, so an overlap at or above the smaller tile dimension is a value the
  // UI freely produces - and dropping the block here made every save fail the
  // ADR-204 drift check with nothing naming Overlap as the cause. Nothing
  // downstream needs the guarantee: planTiles already floors the step at
  // MIN_TILE_STEP_MM. A degenerate overlap belongs in Job Review, not here.
  if (!isFiniteNumber(overlapMm) || overlapMm < 0) return {};
  return {
    tiling: {
      tileWidthMm,
      tileHeightMm,
      overlapMm,
      registrationHoles: raw['registrationHoles'] === true,
      ...normalizeTileRegistration(raw['registration']),
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

/**
 * Preserve an explicit worker-transport opt-out as well as opt-in. Absent stays
 * absent so old projects use the compatible driver's default. The unreliable
 * air restart flag remains true-only; malformed values gain no authority.
 */
function optionalDeviceFlags(dev: Record<string, unknown>): Record<string, boolean | undefined> {
  return {
    workerHostedStreaming:
      typeof dev['workerHostedStreaming'] === 'boolean' ? dev['workerHostedStreaming'] : undefined,
    ...(dev['airAssistRestartUnreliable'] === true
      ? { airAssistRestartUnreliable: true as const }
      : {}),
  };
}

function normalizeDevice(dev: Record<string, unknown>): Record<string, unknown> {
  const controllerKind = isKnownControllerKind(dev['controllerKind'])
    ? dev['controllerKind']
    : undefined;
  const scanningOffsets = normalizeScanOffsetTable(dev['scanningOffsets']);
  const compatibleControllerFields = projectDeviceControllerCompatibleFields({
    ...(controllerKind === undefined ? {} : { controllerKind }),
    streamingMode: streamingModeForController(
      controllerKind,
      normalizeGrblStreamingMode(dev['streamingMode']),
    ),
    rxBufferBytes: normalizeGrblRxBufferBytes(dev['rxBufferBytes']),
    gcodeDialect: normalizeGcodeDialectSelection(dev['gcodeDialect']),
  });
  // The old lens calibration and bed alignment were never trustworthy
  // (ADR-440): leave them behind so a reload cannot bring them back.
  const { cameraCalibration: _oldLens, cameraAlignment: _oldAlignment, ...current } = dev;
  const normalized = {
    ...current,
    ...optionalDeviceFlags(dev),
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
    laserArcMoves: laserArcMovesEntry(dev['laserArcMoves']).laserArcMoves, // ADR-432
    ...compatibleControllerFields,
    scanningOffsets,
    bidirectionalScanPolicy: isBidirectionalScanPolicy(dev['bidirectionalScanPolicy'])
      ? dev['bidirectionalScanPolicy']
      : undefined,
    ...recoveredCncDevicePatch(dev),
    scanOffsetCalibrationStatus: normalizeScanOffsetCalibrationStatus(
      dev['scanOffsetCalibrationStatus'],
      scanningOffsets,
    ),
    controlledLaserOffTravelFeedMmPerMin:
      typeof dev['controlledLaserOffTravelFeedMmPerMin'] === 'number' &&
      Number.isFinite(dev['controlledLaserOffTravelFeedMmPerMin']) &&
      dev['controlledLaserOffTravelFeedMmPerMin'] > 0 &&
      typeof dev['maxFeed'] === 'number' &&
      dev['controlledLaserOffTravelFeedMmPerMin'] <= dev['maxFeed']
        ? dev['controlledLaserOffTravelFeedMmPerMin']
        : undefined,
    // Override (not merge) the raw value so a malformed persisted camera model is
    // dropped to undefined rather than trusted; JSON.stringify omits the undefined.
    cameraModel: normalizeCameraModelRecord(dev['cameraModel']),
    otherCameraModels: normalizeOtherCameraModels(dev['otherCameraModels']),
    fireControl: normalizeLaserFireControl(dev['fireControl']),
    noGoZones: Array.isArray(dev['noGoZones']) ? dev['noGoZones'] : [],
    ...(dev['cameraProfile'] !== undefined
      ? { cameraProfile: normalizeCameraProfile(dev['cameraProfile'] as CameraProfile) }
      : {}),
    ...normalizeZTravelPatch(dev),
    ...normalizeControllerPatch(dev),
  };
  return normalized;
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
  // Same finiteness rule as every sibling helper: the shape validator covers
  // today's two callers, but this helper's name invites use on fields it
  // doesn't — an unguarded Infinity here would ride into emitted G-code.
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// A saved frame feed is the operator's choice, even when it equals the generic
// default, and Save refuses any value a reload would change (ADR-204). Only a
// device saved without a usable feed takes a preset, and a Neotronics 4040
// takes its own slower one rather than the generic default.
function normalizeFramingFeed(dev: Record<string, unknown>): number {
  const saved = dev['framingFeedMmPerMin'];
  if (isFiniteNumber(saved) && saved > 0) return saved;
  return isNeotronicsDevice(dev)
    ? NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.framingFeedMmPerMin
    : DEFAULT_DEVICE_PROFILE.framingFeedMmPerMin;
}

function isNeotronicsDevice(dev: Record<string, unknown>): boolean {
  return (
    dev['profileId'] === NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.profileId ||
    dev['machineFamily'] === NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.machineFamily
  );
}

function positiveField<K extends string>(
  raw: Record<string, unknown>,
  key: K,
): Partial<Record<K, number>> {
  const value = raw[key];
  return isFiniteNumber(value) && value > 0 ? ({ [key]: value } as Record<K, number>) : {};
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
  const legacyReduce =
    typeof value['reduceTravelMoves'] === 'boolean'
      ? value['reduceTravelMoves']
      : DEFAULT_PROJECT_OPTIMIZATION.reduceTravelMoves;
  const travelPolicy =
    value['travelPolicy'] === 'nearest-neighbor' || value['travelPolicy'] === 'source-order'
      ? value['travelPolicy']
      : legacyReduce
        ? 'nearest-neighbor'
        : 'source-order';
  return {
    reduceTravelMoves: travelPolicy === 'nearest-neighbor',
    travelPolicy,
    insideFirst: booleanOrDefault(value['insideFirst'], DEFAULT_PROJECT_OPTIMIZATION.insideFirst),
    removeOverlappingLines: booleanOrDefault(value['removeOverlappingLines'], false),
    ...overlapMergeTolerance(value['overlapMergeToleranceMm']),
    layerPriority:
      value['layerPriority'] === 'reverse-project-order'
        ? 'reverse-project-order'
        : 'project-order',
    pathDirection: value['pathDirection'] === 'preserve' ? 'preserve' : 'allow-reverse',
    startPoint:
      value['startPoint'] === 'job-lower-left' || value['startPoint'] === 'job-center'
        ? value['startPoint']
        : 'machine-origin',
    ...normalizedLineStartRegion(value['lineStartRegion']),
    // Absent in files written before LBG-C04: they start closed shapes where drawn.
    closedShapeStart:
      value['closedShapeStart'] === 'nearest' || value['closedShapeStart'] === 'nearest-corner'
        ? value['closedShapeStart']
        : 'drawn',
  };
}

function normalizedLineStartRegion(
  value: unknown,
): Pick<Project['optimization'], 'lineStartRegion'> {
  return isLineStartRegion(value) ? { lineStartRegion: value } : {};
}

// LBG-C13. Kept absent when a file never set it (every file before the option),
// so such a project saves byte for byte as it was read.
function overlapMergeTolerance(
  value: unknown,
): Pick<Project['optimization'], 'overlapMergeToleranceMm'> {
  return typeof value === 'number' && Number.isFinite(value)
    ? { overlapMergeToleranceMm: clampOverlapMergeTolerance(value) }
    : {};
}

function normalizeAirAssistCommand(value: unknown): Project['device']['airAssistCommand'] {
  return value === 'M7' || value === 'M8' ? value : DEFAULT_DEVICE_PROFILE.airAssistCommand;
}
