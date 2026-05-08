/**
 * === FILE: /src/core/job/JobCompiler.ts ===
 * 
 * Purpose:    Compiles a Scene into a Job. This is the bridge between
 *             the design world (objects, layers, transforms) and the
 *             manufacturing world (operations, flat paths, settings).
 *             After this step, the scene graph is no longer needed.
 * 
 * Pipeline:   Scene → [compileJob()] → Job
 *
 * Canvas → machine Y mapping for G-code is **not** done here; see
 * `applyMachineTransform` in `/src/core/plan/MachineTransform.ts` (uses device
 * `originCorner` and physical bed height from profile or GRBL $$).
 *
 * Dependencies:
 *   - /src/core/types.ts
 *   - /src/core/scene/Scene.ts
 *   - /src/core/scene/SceneObject.ts
 *   - /src/core/scene/Layer.ts
 *   - /src/core/job/Job.ts
 * Last updated: Phase 1, Step 1 — Foundation
 */

import { type Point, type AABB, emptyAABB, mergeAABB, generateId, MAX_LASER_SPEED, MIN_LASER_SPEED } from '../types';
import { type Scene, getOutputLayers, getObjectsByLayer } from '../scene/Scene';
import { type SceneObject, type Geometry, type ImageGeometry } from '../scene/SceneObject';
import { type ImageRasterMode, type Layer, sortLayersByProcessingOrder } from '../scene/Layer';
import { ditherImage, type DitherMode } from '../../import/Dithering';
import {
  adjustBrightness,
  adjustContrast,
  adjustGamma,
  invertImage,
  thresholdToOneBit,
} from '../image/ImageProcessing';
import {
  type Job, type Operation, type OperationType, type OperationGeometry,
  type ResolvedLaserSettings, type FlatPath, type ProcessedBitmap,
  createEmptyJob, flatPathFromPoints,
} from './Job';
import {
  compoundPathFromContours,
  makeContour,
  type CompoundPath,
  type ContourRole,
} from '../geometry/CompoundPath';
import { orderOperationsWithMetrics, type OrderableShape } from '../plan/OperationOrderer';
import { getActiveProfile } from '../devices/DeviceProfile';
import { EMPTY_OFFSET_TABLE, type ScanningOffsetTable } from '../plan/ScanningOffset';
import { computeSmartOverscan } from '../plan/SmartOverscan';
import { getPresetById } from '../materials/MaterialLibrary';
import { canUseFeature } from '../../entitlements';

export interface CompileJobOptions {
  optimizeOrder?: boolean;
  /** From GRBL $120/$121 (min of X,Y) when connected; overrides profile for raster kinematics. */
  machineAccelMmPerS2?: number | null;
  /**
   * Whether active output firmware already applies dynamic laser scaling (for
   * example GRBL M4). When true, software accel-aware splitting is disabled.
   */
  strategySupportsDynamicLaserPower?: boolean;
  /** Cooperative cancellation checked at compile-loop boundaries. */
  signal?: AbortSignal;
  /** Object-level progress for synchronous compileJob callers. */
  onProgress?: (event: CompileJobProgress) => void;
}

export interface CompileJobProgress {
  fraction: number;
  completedObjects: number;
  totalObjects: number;
  layerIndex: number;
  layerCount: number;
  objectIndex: number;
  objectCount: number;
  detail?: string;
}

/** Min/max plausible acceleration (mm/s²) for controller-reported and profile-sourced values. */
const MIN_PLAUSIBLE_ACCEL_MM_PER_S2 = 100;
const MAX_PLAUSIBLE_ACCEL_MM_PER_S2 = 20000;
const DEFAULT_RASTER_MAX_ACCEL_MM_PER_S2 = 1000;

interface EntitlementPolicy {
  allowTabs: boolean;
  allowOvercut: boolean;
  allowLeadIn: boolean;
  allowCrossHatch: boolean;
  allowPowerScale: boolean;
  allowCutStartPoint: boolean;
  droppedFeatures: Set<string>;
}

function createEntitlementPolicy(): EntitlementPolicy {
  // T1-78 Phase 2a: flag-builder call sites → canUseFeature (boolean
  // semantics). These six values feed `allow*` flags consumed
  // downstream; no enforcement happens here, so the explicit boolean
  // form is the right idiom.
  return {
    allowTabs: canUseFeature('tabs'),
    allowOvercut: canUseFeature('overcut'),
    allowLeadIn: canUseFeature('lead_in'),
    allowCrossHatch: canUseFeature('cross_hatch'),
    allowPowerScale: canUseFeature('power_scale'),
    allowCutStartPoint: canUseFeature('cut_start_point'),
    droppedFeatures: new Set<string>(),
  };
}

function recordDropped(policy: EntitlementPolicy, feature: string, active: boolean): void {
  if (active) policy.droppedFeatures.add(feature);
}

function isPlausibleMachineAccel(value: number | null | undefined): boolean {
  return (
    value != null
    && Number.isFinite(value)
    && value >= MIN_PLAUSIBLE_ACCEL_MM_PER_S2
    && value <= MAX_PLAUSIBLE_ACCEL_MM_PER_S2
  );
}

/**
 * Picks an acceleration (mm/s²) for acceleration-aware raster power. Controller value wins if
 * sensible; else profile; else 1000. A warning is emitted when the controller reported a value
 * that was ignored and the profile was not a usable fallback (both bad / missing as appropriate).
 * Exported for unit tests.
 */
export function resolveMaxAccelMmPerS2(
  machineAccel: number | null | undefined,
  profileAccel: number | null | undefined,
): { value: number; warnImplausibleController: boolean; ignoredDetected?: number } {
  if (isPlausibleMachineAccel(machineAccel)) {
    return { value: machineAccel as number, warnImplausibleController: false };
  }
  if (isPlausibleMachineAccel(profileAccel)) {
    return { value: profileAccel as number, warnImplausibleController: false };
  }
  const warn =
    machineAccel != null
    && !isPlausibleMachineAccel(machineAccel)
    && !isPlausibleMachineAccel(profileAccel);
  return {
    value: DEFAULT_RASTER_MAX_ACCEL_MM_PER_S2,
    warnImplausibleController: warn,
    ignoredDetected: warn ? Number(machineAccel) : undefined,
  };
}

function vectorOpToOrderableShape(
  op: Operation,
  layerPhase: number,
  sceneIndex: number,
): OrderableShape | null {
  if (op.geometry.type !== 'vector' && op.geometry.type !== 'fill') return null;
  const paths = op.geometry.paths;
  if (paths.length === 0) return null;
  const c = paths[0].coords;
  if (c.length < 2) return null;
  const mode: OrderableShape['mode'] =
    op.type === 'engrave' ? 'engrave' : op.type === 'score' ? 'score' : 'cut';
  return {
    id: op.id,
    mode,
    boundingBox: { ...op.bounds },
    startPoint: { x: c[0], y: c[1] },
    endPoint: { x: c[0], y: c[1] },
    layerIndex: layerPhase,
    sceneIndex,
    settingsKey: JSON.stringify(op.settings),
    operation: op,
  };
}

function objectsOnLayerInSceneOrder(scene: Scene, layerId: string): SceneObject[] {
  return scene.objects.filter(o => o.layerId === layerId && o.visible);
}

function throwIfCompileAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Compile cancelled', 'AbortError');
  }
}

function countCompilableObjects(scene: Scene, outputLayers: readonly Layer[]): number {
  let count = 0;
  for (const layer of outputLayers) {
    const objects = getObjectsByLayer(scene, layer.id).filter(o => o.visible);
    if (layer.settings.mode === 'image') {
      count += objects.filter(o => o.geometry.type === 'image').length;
    } else {
      count += objects.length;
    }
  }
  return count;
}

function reportCompileProgress(
  options: CompileJobOptions | undefined,
  event: Omit<CompileJobProgress, 'fraction'>,
): void {
  if (!options?.onProgress) return;
  const total = Math.max(1, event.totalObjects);
  const fraction = Math.max(0, Math.min(1, event.completedObjects / total));
  options.onProgress({ ...event, fraction });
}

// ─── MAIN COMPILER ───────────────────────────────────────────────

export function compileJob(scene: Scene, options?: CompileJobOptions): Job {
  throwIfCompileAborted(options?.signal);
  const job = createEmptyJob(scene.metadata.name, scene.id);
  const outputLayers = sortLayersByProcessingOrder(getOutputLayers(scene));
  const optimizeOrder = options?.optimizeOrder ?? scene.compileOptions?.optimizeOrder !== false;
  const compileOpts = options;
  const sceneMaterialName = scene.material?.name ?? null;
  const entitlementPolicy = createEntitlementPolicy();

  let totalObjects = 0;
  const progressTotalObjects = countCompilableObjects(scene, outputLayers);
  let completedObjects = 0;

  const markObjectCompiled = (
    layerIndex: number,
    objectIndex: number,
    objectCount: number,
  ): void => {
    completedObjects++;
    reportCompileProgress(options, {
      completedObjects,
      totalObjects: progressTotalObjects,
      layerIndex,
      layerCount: outputLayers.length,
      objectIndex,
      objectCount,
      detail: `Compiled ${completedObjects}/${progressTotalObjects} job objects`,
    });
    throwIfCompileAborted(options?.signal);
  };

  if (!optimizeOrder) {
    for (let layerIndex = 0; layerIndex < outputLayers.length; layerIndex++) {
      throwIfCompileAborted(options?.signal);
      const layer = outputLayers[layerIndex];
      const objects = getObjectsByLayer(scene, layer.id);
      if (objects.length === 0) continue;

      if (layer.settings.mode === 'image') {
        const visibleImageObjects = objects.filter(obj => obj.visible && obj.geometry.type === 'image');
        for (let objectIndex = 0; objectIndex < visibleImageObjects.length; objectIndex++) {
          throwIfCompileAborted(options?.signal);
          const obj = visibleImageObjects[objectIndex];
          if (!obj.visible || obj.geometry.type !== 'image') continue;
          const imgOp = compileOperation(layer, [obj], sceneMaterialName, entitlementPolicy, compileOpts);
          if (imgOp) {
            job.operations.push(imgOp);
            job.bounds = mergeAABB(job.bounds, imgOp.bounds);
            totalObjects++;
          }
          markObjectCompiled(layerIndex, objectIndex, visibleImageObjects.length);
        }
        continue;
      }

      const visibleObjects = objects.filter(obj => obj.visible);
      const operation = compileOperation(layer, visibleObjects, sceneMaterialName, entitlementPolicy, compileOpts);
      if (operation) {
        job.operations.push(operation);
        job.bounds = mergeAABB(job.bounds, operation.bounds);
        totalObjects += visibleObjects.length;
      }
      for (let objectIndex = 0; objectIndex < visibleObjects.length; objectIndex++) {
        markObjectCompiled(layerIndex, objectIndex, visibleObjects.length);
      }
    }
  } else {
    const firstImageLayerPhase = outputLayers.findIndex(l => l.settings.mode === 'image');
    const splitPhase = firstImageLayerPhase < 0 ? outputLayers.length : firstImageLayerPhase;

    const rasterOps: Operation[] = [];
    const preVectorShapes: OrderableShape[] = [];
    const postVectorShapes: OrderableShape[] = [];

    for (let phase = 0; phase < outputLayers.length; phase++) {
      throwIfCompileAborted(options?.signal);
      const layer = outputLayers[phase];
      const orderedObjs = objectsOnLayerInSceneOrder(scene, layer.id);
      if (orderedObjs.length === 0) continue;

      if (layer.settings.mode === 'image') {
        const imageObjects = orderedObjs.filter(obj => obj.geometry.type === 'image');
        for (let objectIndex = 0; objectIndex < imageObjects.length; objectIndex++) {
          throwIfCompileAborted(options?.signal);
          const obj = imageObjects[objectIndex];
          const imgOp = compileOperation(layer, [obj], sceneMaterialName, entitlementPolicy, compileOpts);
          if (imgOp) {
            rasterOps.push(imgOp);
            job.bounds = mergeAABB(job.bounds, imgOp.bounds);
            totalObjects++;
          }
          markObjectCompiled(phase, objectIndex, imageObjects.length);
        }
        continue;
      }

      const targetPool = phase < splitPhase ? preVectorShapes : postVectorShapes;
      const sceneIndexById = new Map(scene.objects.map((o, i) => [o.id, i]));

      for (let objectIndex = 0; objectIndex < orderedObjs.length; objectIndex++) {
        throwIfCompileAborted(options?.signal);
        const obj = orderedObjs[objectIndex];
        const op = compileOperation(layer, [obj], sceneMaterialName, entitlementPolicy, compileOpts);
        if (!op) {
          markObjectCompiled(phase, objectIndex, orderedObjs.length);
          continue;
        }
        if (op.geometry.type !== 'vector' && op.geometry.type !== 'fill') {
          markObjectCompiled(phase, objectIndex, orderedObjs.length);
          continue;
        }
        const shape = vectorOpToOrderableShape(op, phase, sceneIndexById.get(obj.id) ?? 0);
        if (!shape) {
          markObjectCompiled(phase, objectIndex, orderedObjs.length);
          continue;
        }
        targetPool.push(shape);
        totalObjects++;
        markObjectCompiled(phase, objectIndex, orderedObjs.length);
      }
    }

    const pushOrdered = (pool: OrderableShape[], label: string) => {
      if (pool.length === 0) return;
      const distinctKeys = new Set(pool.map(s => s.settingsKey));
      if (distinctKeys.size > 6) {
        console.warn(
          `[Optimize] Many distinct laser setting groups (${distinctKeys.size}) in ${label} — order stays within settings groups (no cross-settings NN).`,
        );
      }
      const { ordered } = orderOperationsWithMetrics(pool, '[Optimize]');
      for (const s of ordered) {
        const op = s.operation;
        if (!op) continue;
        job.operations.push(op);
        job.bounds = mergeAABB(job.bounds, op.bounds);
      }
    };

    pushOrdered(preVectorShapes, 'pre-raster');
    for (const ro of rasterOps) {
      job.operations.push(ro);
    }
    pushOrdered(postVectorShapes, 'post-raster');
  }

  job.metadata.objectCount = totalObjects;
  job.metadata.layerCount = job.operations.length;

  const spX = scene.startPosition?.x ?? 0;
  const spY = scene.startPosition?.y ?? 0;
  job.metadata.startPositionX = spX;
  job.metadata.startPositionY = spY;

  if (entitlementPolicy.droppedFeatures.size > 0) {
    console.warn(
      `[entitlement] Pro features dropped during compile (no Pro license): ${[...entitlementPolicy.droppedFeatures].join(', ')}.`,
    );
  }

  return job;
}

// ─── COMPILE SINGLE OPERATION ────────────────────────────────────

function compileOperation(
  layer: Layer,
  objects: SceneObject[],
  sceneMaterialName: string | null,
  entitlementPolicy: EntitlementPolicy,
  jobOpts?: CompileJobOptions,
): Operation | null {
  const type = mapModeToType(layer.settings.mode);
  const settings = resolveSettings(layer, sceneMaterialName, entitlementPolicy, jobOpts);
  const geometry = compileGeometry(type, layer, objects, entitlementPolicy);

  if (!geometry) return null;

  // Calculate operation bounds
  let bounds = emptyAABB();
  if (geometry.type === 'vector' || geometry.type === 'fill') {
    for (const path of geometry.paths) {
      bounds = mergeAABB(bounds, path.bounds);
    }
  } else if (geometry.type === 'raster') {
    const bm = geometry.bitmap;
    bounds = {
      minX: bm.position.x,
      minY: bm.position.y,
      maxX: bm.position.x + bm.physicalWidth,
      maxY: bm.position.y + bm.physicalHeight,
    };
  }

  return {
    id: generateId(),
    layerId: layer.id,
    layerName: layer.name,
    layerColor: layer.color,
    order: layer.order,
    type,
    settings,
    geometry,
    bounds,
  };
}

// ─── MODE MAPPING ────────────────────────────────────────────────

function mapModeToType(mode: import('../scene/Layer').LayerMode): OperationType {
  switch (mode) {
    case 'cut':     return 'cut';
    case 'engrave': return 'engrave';
    case 'score':   return 'score';
    case 'image':   return 'raster';
  }
}

// ─── RESOLVE SETTINGS ────────────────────────────────────────────
/**
 * Convert Layer's LaserSettings into fully resolved ResolvedLaserSettings.
 * No nulls, no defaults, no conditional logic downstream.
 */
function resolveSettings(
  layer: Layer,
  sceneMaterialName: string | null,
  entitlementPolicy: EntitlementPolicy,
  jobOpts?: CompileJobOptions,
): ResolvedLaserSettings {
  const s = layer.settings;
  const profile = getActiveProfile();

  // Prefer the linked preset's responseCurve (post-D.13-migration path).
  // Fall back to the legacy per-device-profile map keyed by scene material
  // name, so existing user data keeps working until it migrates.
  const linkedPreset = s.materialPresetId ? getPresetById(s.materialPresetId) : undefined;
  let responseCurve = linkedPreset?.responseCurve;
  if (!responseCurve && sceneMaterialName != null && sceneMaterialName.trim().length > 0) {
    const curves = profile?.responseCurves;
    if (curves) {
      const exact = curves[sceneMaterialName];
      if (exact) {
        responseCurve = exact;
      } else {
        const key = Object.keys(curves).find(
          k => k.toLowerCase() === sceneMaterialName.toLowerCase(),
        );
        if (key) responseCurve = curves[key];
      }
    }
  }

  const { value: maxAccelMmPerS2, warnImplausibleController, ignoredDetected } = resolveMaxAccelMmPerS2(
    jobOpts?.machineAccelMmPerS2,
    profile?.maxAccelMmPerS2,
  );
  if (warnImplausibleController) {
    console.warn(
      `[JobCompiler] Controller reported implausible acceleration ${ignoredDetected} mm/s²; ` +
        `expected range [${MIN_PLAUSIBLE_ACCEL_MM_PER_S2}, ${MAX_PLAUSIBLE_ACCEL_MM_PER_S2}]. ` +
        `No usable profile fallback. Using default ${maxAccelMmPerS2} mm/s².`,
    );
  }
  const userRequestedAccelAwarePower =
    s.accelAwarePower ?? profile?.accelAwarePower ?? true;
  // Firmware dynamic power (GRBL M4) and software splitting must not stack.
  const accelAwarePower =
    jobOpts?.strategySupportsDynamicLaserPower
      ? false
      : userRequestedAccelAwarePower;
  const minPowerRatioAccel =
    s.minPowerRatioAccel ?? profile?.minPowerRatioAccel ?? 0.1;
  const grayscalePowerMergeTolerance =
    typeof s.image.grayscalePowerMergeTolerance === 'number' && Number.isFinite(s.image.grayscalePowerMergeTolerance)
      ? Math.max(0, Math.min(100, s.image.grayscalePowerMergeTolerance))
      : 2;

  let scanningOffsets: ScanningOffsetTable = EMPTY_OFFSET_TABLE;
  if (s.useScanOffsets === false) {
    scanningOffsets = EMPTY_OFFSET_TABLE;
  } else if (s.scanningOffsets && s.scanningOffsets.length > 0) {
    scanningOffsets = s.scanningOffsets;
  } else if (
    s.useScanOffsets === true
    && profile?.scanningOffsets
    && profile.scanningOffsets.length > 0
  ) {
    scanningOffsets = profile.scanningOffsets;
  }

  /** Engrave always needs scanline spacing; do not rely only on fill.enabled. */
  const fillActiveForEngrave = s.fill.enabled || s.mode === 'engrave';
  const rawIv = Number(s.fill.interval);
  const engraveFillInterval =
    s.mode === 'engrave' && fillActiveForEngrave
      ? Math.max(0.01, Number.isFinite(rawIv) && rawIv > 0 ? rawIv : 0.1)
      : 0;

  const resolvedSpeed = Math.max(MIN_LASER_SPEED, Math.min(MAX_LASER_SPEED, s.speed));
  const smartOverscanEnabled = s.smartOverscanEnabled ?? profile?.smartOverscanEnabled ?? true;
  let overscanning: number;
  if (smartOverscanEnabled) {
    overscanning = computeSmartOverscan({
      scanSpeedMmPerMin: resolvedSpeed,
      maxAccelMmPerS2,
      accelAwarePowerEnabled: accelAwarePower,
    }).overscanMm;
  } else {
    const manual = s.fill.overscanning;
    overscanning = Math.max(
      0,
      Number.isFinite(manual) && manual >= 0
        ? manual
        : profile?.overscanMm ?? 2.5,
    );
  }

  const tabsActive =
    s.tabs?.enabled === true
      ? (Number(s.tabs?.count) || 0) > 0 && (Number(s.tabs?.width) || 0) > 0
      : s.cut.tabCount > 0 && s.cut.tabWidth > 0;
  const crossHatchActive = s.fill.mode === 'cross-hatch';
  recordDropped(entitlementPolicy, 'tabs', !entitlementPolicy.allowTabs && tabsActive);
  recordDropped(entitlementPolicy, 'overcut', !entitlementPolicy.allowOvercut && s.cut.overcut > 0);
  recordDropped(entitlementPolicy, 'lead_in', !entitlementPolicy.allowLeadIn && s.cut.leadIn > 0);
  recordDropped(entitlementPolicy, 'cross_hatch', !entitlementPolicy.allowCrossHatch && crossHatchActive);

  const fillMode =
    crossHatchActive && !entitlementPolicy.allowCrossHatch
      ? 'line'
      : s.fill.mode === 'offset' || s.fill.mode === 'cross-hatch' ? s.fill.mode : 'line';
  const tabCount =
    entitlementPolicy.allowTabs
      ? s.tabs?.enabled === true
        ? Math.max(0, Math.floor(Number(s.tabs?.count) || 0))
        : Math.max(0, Math.floor(s.cut.tabCount))
      : 0;
  const tabWidth =
    entitlementPolicy.allowTabs
      ? s.tabs?.enabled === true
        ? Math.max(0, Number(s.tabs?.width) || 0)
        : Math.max(0, s.cut.tabWidth)
      : 0;

  return {
    powerMin: Math.max(0, Math.min(100, s.power.min)),
    powerMax: Math.max(0, Math.min(100, s.power.max)),
    speed: resolvedSpeed,
    passes: Math.max(1, Math.min(99, s.passes)),
    zStepPerPass: s.zStepPerPass,

    fillInterval: engraveFillInterval,
    fillAngle: s.fill.angle % 360,
    fillMode,
    fillBiDirectional: s.fill.biDirectional !== false,
    overscanning,

    overcut: entitlementPolicy.allowOvercut ? Math.max(0, s.cut.overcut) : 0,
    leadIn: entitlementPolicy.allowLeadIn ? Math.max(0, s.cut.leadIn) : 0,
    tabCount,
    tabWidth,
    insideFirst: s.cut.insideFirst,

    airAssist: s.airAssist,

    accelAwarePower,
    maxAccelMmPerS2,
    minPowerRatioAccel,

    scanningOffsets,
    grayscalePowerMergeTolerance,
    responseCurve,
  };
}

// ─── COMPILE GEOMETRY ────────────────────────────────────────────

/** Reverse raster rows and/or columns so negative scale (mirror) matches canvas preview. */
function mirrorRasterData(
  data: Uint8Array,
  width: number,
  height: number,
  flipX: boolean,
  flipY: boolean,
): Uint8Array {
  let buf = data;
  if (flipY) {
    const next = new Uint8Array(width * height);
    for (let r = 0; r < height; r++) {
      next.set(buf.subarray(r * width, (r + 1) * width), (height - 1 - r) * width);
    }
    buf = next;
  }
  if (flipX) {
    const next = new Uint8Array(buf.length);
    for (let r = 0; r < height; r++) {
      const row = r * width;
      for (let c = 0; c < width; c++) {
        next[row + c] = buf[row + (width - 1 - c)];
      }
    }
    buf = next;
  }
  return buf;
}

function compileGeometry(
  type: OperationType,
  layer: Layer,
  objects: SceneObject[],
  entitlementPolicy: EntitlementPolicy,
): OperationGeometry | null {
  if (type === 'raster') {
    const img = layer.settings.image;
    const dpiRaw = img.resolution;
    const dpi =
      typeof dpiRaw === 'number' && Number.isFinite(dpiRaw) && dpiRaw > 0 ? dpiRaw : 254;

    const brightness = typeof img.brightness === 'number' && Number.isFinite(img.brightness)
      ? Math.max(-100, Math.min(100, img.brightness))
      : 0;
    const contrast = typeof img.contrast === 'number' && Number.isFinite(img.contrast)
      ? Math.max(-100, Math.min(100, img.contrast))
      : 0;
    const gamma = typeof img.gamma === 'number' && Number.isFinite(img.gamma) ? img.gamma : 1;
    const inverted = img.invert === true;
    const ditherMode: DitherMode = img.dithering ?? 'floyd-steinberg';
    const imageThreshold =
      typeof img.imageThreshold === 'number' && Number.isFinite(img.imageThreshold)
        ? Math.max(0, Math.min(255, img.imageThreshold))
        : 128;
    const imageMode: ImageRasterMode = img.imageMode ?? (img.passThrough ? 'grayscale' : 'dither');

    for (const obj of objects) {
      if (!obj.visible) continue;
      if (obj.geometry.type !== 'image') continue;

      const geom = obj.geometry;
      const sx = obj.transform.a;
      const sy = obj.transform.d;
      const scaleAbsX = Math.abs(sx) || 1;
      const scaleAbsY = Math.abs(sy) || 1;
      const wMm = ((geom.cropWidth || geom.originalWidth) / 96) * 25.4;
      const hMm = ((geom.cropHeight || geom.originalHeight) / 96) * 25.4;
      const physicalWidth = wMm * scaleAbsX;
      const physicalHeight = hMm * scaleAbsY;
      const flipRasterX = sx < 0;
      const flipRasterY = sy < 0;
      const rasterPosX = Math.min(obj.transform.tx, obj.transform.tx + sx * wMm);
      const rasterPosY = Math.min(obj.transform.ty, obj.transform.ty + sy * hMm);

      let bitmapWidth: number;
      let bitmapHeight: number;
      let data: Uint8Array;
      let mode: '1bit' | 'grayscale';

      const pixelData = geom.grayscaleData;
      if (pixelData && geom.grayscaleWidth && geom.grayscaleHeight) {
        bitmapWidth = geom.grayscaleWidth;
        bitmapHeight = geom.grayscaleHeight;
        // T1-17 Pass 4b: if the UI has pre-computed the post-pipeline
        // grayscale via the worker (Pass 4c) and the cached fingerprint
        // matches the layer's current brightness/contrast/gamma/invert,
        // reuse it and skip the four legacy ImageProcessing.ts loops.
        // Mismatch or absence falls back to the existing path —
        // recompiles without the cache stay byte-for-byte unchanged.
        const ps = geom.processedSettings;
        const canReuseProcessed =
          geom.processedData != null &&
          geom.processedData.length === pixelData.length &&
          ps != null &&
          ps.brightness === brightness &&
          ps.contrast === contrast &&
          ps.gamma === gamma &&
          ps.invert === inverted;
        let gray: Uint8Array;
        if (canReuseProcessed && geom.processedData) {
          gray = new Uint8Array(geom.processedData);
        } else {
          gray = new Uint8Array(pixelData);
          if (brightness !== 0) gray = adjustBrightness(gray, brightness);
          if (contrast !== 0) gray = adjustContrast(gray, contrast);
          if (gamma !== 1) gray = adjustGamma(gray, gamma);
          if (inverted) gray = invertImage(gray);
        }

        if (imageMode === 'grayscale') {
          data = gray;
          mode = 'grayscale';
        } else if (imageMode === 'threshold') {
          data = thresholdToOneBit(gray, bitmapWidth, bitmapHeight, imageThreshold);
          mode = '1bit';
        } else {
          if (ditherMode === 'none') {
            data = gray;
            mode = 'grayscale';
          } else {
            data = ditherImage(gray, bitmapWidth, bitmapHeight, ditherMode, imageThreshold);
            mode = '1bit';
          }
        }
        if (flipRasterX || flipRasterY) {
          data = mirrorRasterData(data, bitmapWidth, bitmapHeight, flipRasterX, flipRasterY);
        }
      } else {
        console.warn(
          `[LaserForge] Skipping image "${obj.name || obj.id}": no raster bitmap data (import or adjust image to produce grayscale pixels).`,
        );
        return null;
      }

      const bitmap: ProcessedBitmap = {
        width: bitmapWidth,
        height: bitmapHeight,
        dpi,
        sourceObjectId: obj.id,
        mode,
        data,
        physicalWidth,
        physicalHeight,
        position: {
          x: rasterPosX,
          y: rasterPosY,
        },
        pipeline: {
          brightness,
          contrast,
          gamma,
          ditheringMode: ditherMode,
          inverted,
          imageMode,
          imageThreshold,
        },
      };

      return { type: 'raster', bitmap };
    }
    return null;
  }

  const paths: FlatPath[] = [];
  const compoundPaths: CompoundPath[] = [];

  for (const obj of objects) {
    if (!obj.visible) continue;
    const flatPaths = flattenObject(obj, type, entitlementPolicy);
    for (let i = 0; i < flatPaths.length; i++) {
      paths.push(flatPaths[i]);
    }
    const compoundPath = flattenObjectAsCompound(obj, type);
    if (compoundPath && compoundPath.contours.length > 0) {
      compoundPaths.push(compoundPath);
    }
  }

  if (paths.length === 0) return null;

  if (type === 'engrave') {
    return { type: 'fill', paths, compoundPaths };
  }
  return { type: 'vector', paths, compoundPaths };
}

// ─── FLATTEN OBJECT TO FLAT PATHS ────────────────────────────────
/**
 * Converts a SceneObject (with transform) into FlatPath(s)
 * in world coordinates. Strips away all scene graph overhead.
 *
 * T1-38: `operationType` selects the flattening tolerance for SVG-imported
 * paths. Default 0.5mm was visibly faceted on small / curve-heavy work.
 */
function flattenObject(
  obj: SceneObject,
  operationType: OperationType,
  entitlementPolicy: EntitlementPolicy,
): FlatPath[] {
  const points = geometryToPoints(obj.geometry, operationType);
  if (points.length === 0) return [];

  // Apply object transform to all points
  const transformed = points.map(group => ({
    points: group.points.map(p => applyTransform(p, obj.transform)),
    closed: group.closed,
  }));

  return transformed.map(group => {
    let pts = group.points;
    if (group.closed && pts.length > 1) {
      const hasCutStartPoint = (obj.cutStartIndex ?? 0) !== 0;
      recordDropped(
        entitlementPolicy,
        'cut_start_point',
        !entitlementPolicy.allowCutStartPoint && hasCutStartPoint,
      );
      const idx = entitlementPolicy.allowCutStartPoint ? (obj.cutStartIndex ?? 0) % pts.length : 0;
      if (idx !== 0) {
        pts = [...pts.slice(idx), ...pts.slice(0, idx)];
      }
    }
    const rawPowerScale = obj.powerScale ?? 1.0;
    recordDropped(
      entitlementPolicy,
      'power_scale',
      !entitlementPolicy.allowPowerScale && rawPowerScale !== 1.0,
    );
    return flatPathFromPoints(
      pts,
      group.closed,
      obj.id,
      entitlementPolicy.allowPowerScale ? rawPowerScale : 1.0,
    );
  });
}

// T2-15: preserve compound contour semantics beside the legacy FlatPath output.

function flattenObjectAsCompound(
  obj: SceneObject,
  operationType: OperationType,
): CompoundPath | null {
  const groups = geometryToPoints(obj.geometry, operationType)
    .map(group => ({
      points: group.points.map(p => applyTransform(p, obj.transform)),
      closed: group.closed,
    }))
    .filter(group => group.points.length >= (group.closed ? 3 : 2));

  if (groups.length === 0) return null;

  const roles = inferCompoundRoles(groups);
  return compoundPathFromContours({
    sourceObjectId: obj.id,
    contours: groups.map((group, index) => makeContour(group.points, group.closed, roles[index])),
  });
}

function inferCompoundRoles(groups: readonly PointGroup[]): ContourRole[] {
  return groups.map((group, index) => {
    if (!group.closed) return 'open';

    const sample = group.points[0];
    let depth = 0;
    for (let i = 0; i < groups.length; i++) {
      if (i === index) continue;
      const candidate = groups[i];
      if (!candidate.closed || candidate.points.length < 3) continue;
      if (pointInPointGroup(sample, candidate.points)) depth++;
    }

    if (depth % 2 === 1) return 'hole';
    return depth === 0 ? 'outer' : 'island';
  });
}

function pointInPointGroup(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = (yi > point.y) !== (yj > point.y) &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// ─── GEOMETRY TO POINTS ──────────────────────────────────────────

export interface PointGroup {
  points: Point[];
  closed: boolean;
}

/**
 * T1-38: operation-aware flattening tolerance for SVG-imported paths.
 *
 *   cut    : 0.05mm — visible workpiece edge; faceting telegraphs as bumps.
 *   score  : 0.05mm — visible engraved line; same constraint as cut.
 *   engrave: 0.03mm — fills hug the boundary; faceting compounds via stripe-end
 *            offsets and shows up as ringing on curved fills.
 *   raster : 0.5mm — never reached on this code path (raster geometry doesn't
 *            flow through subPathToPoints), but defined for completeness so a
 *            future raster-vector merge doesn't silently regress.
 *
 * Text uses a separate constant (TEXT_FLATNESS_MM = 0.05mm at the call site)
 * because the loop knows it's text and the value is correct already.
 *
 * Per-layer override (LayerSettings.flatteningTolerance) is filed as a future
 * T1-38 follow-up if user-tunable tolerance becomes necessary.
 */
export const FLATTEN_TOLERANCE_BY_OPERATION: Record<OperationType, number> = {
  cut: 0.05,
  score: 0.05,
  engrave: 0.03,
  raster: 0.5,
};

export function geometryToPoints(
  geom: Geometry,
  operationType: OperationType = 'cut',
): PointGroup[] {
  switch (geom.type) {
    case 'rect': {
      const { x, y, width, height, cornerRadius } = geom;
      const r = Math.min(cornerRadius || 0, width / 2, height / 2);

      if (r <= 0.01) {
        // Sharp corners
        return [{
          points: [
            { x, y },
            { x: x + width, y },
            { x: x + width, y: y + height },
            { x, y: y + height },
          ],
          closed: true,
        }];
      }

      // Rounded corners — generate arc segments
      const pts: Point[] = [];
      const arcSegments = Math.max(4, Math.ceil(r * 2)); // More segments for larger radii

      // Helper: generate quarter arc points
      const quarterArc = (cx: number, cy: number, startAngle: number) => {
        for (let i = 0; i <= arcSegments; i++) {
          const angle = startAngle + (Math.PI / 2) * (i / arcSegments);
          pts.push({
            x: cx + r * Math.cos(angle),
            y: cy + r * Math.sin(angle),
          });
        }
      };

      // Top edge: left to right, then top-right arc
      pts.push({ x: x + r, y });
      pts.push({ x: x + width - r, y });
      quarterArc(x + width - r, y + r, -Math.PI / 2); // Top-right corner

      // Right edge: top to bottom, then bottom-right arc
      pts.push({ x: x + width, y: y + r });
      pts.push({ x: x + width, y: y + height - r });
      quarterArc(x + width - r, y + height - r, 0); // Bottom-right corner

      // Bottom edge: right to left, then bottom-left arc
      pts.push({ x: x + width - r, y: y + height });
      pts.push({ x: x + r, y: y + height });
      quarterArc(x + r, y + height - r, Math.PI / 2); // Bottom-left corner

      // Left edge: bottom to top, then top-left arc
      pts.push({ x, y: y + height - r });
      pts.push({ x, y: y + r });
      quarterArc(x + r, y + r, Math.PI); // Top-left corner

      // Remove duplicate consecutive points
      const cleaned: Point[] = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const prev = cleaned[cleaned.length - 1];
        if (Math.abs(pts[i].x - prev.x) > 0.001 || Math.abs(pts[i].y - prev.y) > 0.001) {
          cleaned.push(pts[i]);
        }
      }

      return [{ points: cleaned, closed: true }];
    }
    case 'ellipse': {
      const { cx, cy, rx, ry } = geom;
      const segments = Math.max(32, Math.ceil(Math.max(rx, ry) * 4));
      const points: Point[] = [];
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        points.push({
          x: cx + rx * Math.cos(angle),
          y: cy + ry * Math.sin(angle),
        });
      }
      return [{ points, closed: true }];
    }
    case 'line': {
      return [{
        points: [
          { x: geom.x1, y: geom.y1 },
          { x: geom.x2, y: geom.y2 },
        ],
        closed: false,
      }];
    }
    case 'polygon': {
      return [{
        points: [...geom.points],
        closed: geom.closed,
      }];
    }
    case 'path': {
      // T1-38: operation-aware tolerance — was hardcoded 0.5mm which produced
      // visibly faceted curves on small / detailed work (~16 segments on a
      // 20mm circle). Cut / score / engrave each get a tighter default.
      const tolerance = FLATTEN_TOLERANCE_BY_OPERATION[operationType];
      return geom.subPaths.map(sub => ({
        points: subPathToPoints(sub.segments, tolerance),
        closed: sub.closed,
      }));
    }
    case 'text': {
      const subPaths = geom.outlineSubPaths;
      if (!subPaths?.length) return [];
      // Tight flatness for text. Glyph curves are small (5–15mm stroke radius on a typical
      // 10–30mm font), so 0.5mm is visibly faceted. 0.05mm is below kerf width on any diode
      // laser and gives smooth curves at the cost of more subdivision vs large canvas paths.
      const TEXT_FLATNESS_MM = 0.05;
      return subPaths.map(sub => ({
        points: subPathToPoints(sub.segments, TEXT_FLATNESS_MM),
        closed: sub.closed,
      }));
    }
    case 'image':
      // Images are handled by the raster pipeline, not here
      return [];
  }
}

export function subPathToPoints(
  segments: import('../scene/SceneObject').PathSegment[],
  tolerance: number = 0.5,
): Point[] {
  const points: Point[] = [];

  for (const seg of segments) {
    switch (seg.type) {
      case 'move':
      case 'line':
        points.push({ ...seg.to });
        break;
      case 'cubic':
        // Subdivide cubic bezier into line segments
        subdivideCubic(
          points[points.length - 1] || { x: 0, y: 0 },
          seg.cp1, seg.cp2, seg.to,
          points, tolerance,
        );
        break;
      case 'quadratic':
        subdivideQuadratic(
          points[points.length - 1] || { x: 0, y: 0 },
          seg.cp, seg.to,
          points, tolerance,
        );
        break;
      case 'close':
        // Closing is handled by the FlatPath.closed flag
        break;
    }
  }

  return points;
}

// ─── BEZIER SUBDIVISION ──────────────────────────────────────────

function subdivideCubic(
  p0: Point, p1: Point, p2: Point, p3: Point,
  output: Point[], tolerance: number, depth: number = 0
): void {
  if (depth > 10) {
    output.push({ ...p3 });
    return;
  }

  // Flatness test: are control points close to the line p0→p3?
  const dx = p3.x - p0.x, dy = p3.y - p0.y;
  const d1 = Math.abs((p1.x - p3.x) * dy - (p1.y - p3.y) * dx);
  const d2 = Math.abs((p2.x - p3.x) * dy - (p2.y - p3.y) * dx);
  const len = Math.sqrt(dx * dx + dy * dy);

  if ((d1 + d2) / (len || 1) < tolerance) {
    output.push({ ...p3 });
    return;
  }

  // De Casteljau subdivision at t=0.5
  const m01 = midpoint(p0, p1);
  const m12 = midpoint(p1, p2);
  const m23 = midpoint(p2, p3);
  const m012 = midpoint(m01, m12);
  const m123 = midpoint(m12, m23);
  const mid = midpoint(m012, m123);

  subdivideCubic(p0, m01, m012, mid, output, tolerance, depth + 1);
  subdivideCubic(mid, m123, m23, p3, output, tolerance, depth + 1);
}

function subdivideQuadratic(
  p0: Point, p1: Point, p2: Point,
  output: Point[], tolerance: number, depth: number = 0
): void {
  if (depth > 10) {
    output.push({ ...p2 });
    return;
  }

  const dx = p2.x - p0.x, dy = p2.y - p0.y;
  const d = Math.abs((p1.x - p2.x) * dy - (p1.y - p2.y) * dx);
  const len = Math.sqrt(dx * dx + dy * dy);

  if (d / (len || 1) < tolerance) {
    output.push({ ...p2 });
    return;
  }

  const m01 = midpoint(p0, p1);
  const m12 = midpoint(p1, p2);
  const mid = midpoint(m01, m12);

  subdivideQuadratic(p0, m01, mid, output, tolerance, depth + 1);
  subdivideQuadratic(mid, m12, p2, output, tolerance, depth + 1);
}

// ─── TRANSFORM HELPERS ───────────────────────────────────────────

function applyTransform(p: Point, m: import('../types').Matrix3x2): Point {
  return {
    x: m.a * p.x + m.c * p.y + m.tx,
    y: m.b * p.x + m.d * p.y + m.ty,
  };
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
