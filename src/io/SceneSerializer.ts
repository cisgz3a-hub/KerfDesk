/**
 * === FILE: /src/io/SceneSerializer.ts ===
 *
 * Purpose:    Convert Scene ↔ JSON string.
 *
 *             Serialize:  Strip transient state, produce clean JSON.
 *             Deserialize: Validate structure, restore defaults for
 *                          missing optional fields, throw on invalid data.
 *
 *             File format is versioned ('1.0') for future compatibility.
 *             IDs are preserved exactly — no regeneration.
 *
 * Dependencies:
 *   - /src/core/scene/Scene.ts
 *   - /src/core/scene/SceneObject.ts
 *   - /src/core/scene/Layer.ts
 * Last updated: File Save/Load feature
 */

import { type Scene } from '../core/scene/Scene';
import { type SceneObject, type Geometry } from '../core/scene/SceneObject';
import { type Layer } from '../core/scene/Layer';
import { defaultLaserSettings, type LaserSettings, type LayerMode } from '../core/scene/Layer';
import {
  PROJECT_CHECKSUM_ALGORITHM,
  ProjectChecksumMismatchError,
  buildSceneChecksum,
  validateSceneFileChecksum,
} from './ProjectIntegrity';

// ─── FILE FORMAT ─────────────────────────────────────────────────

const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-tsx-fallback';
const CURRENT_FILE_FORMAT_VERSION = '1.2';

interface SceneFile {
  format: 'laserforge';
  version: '1.2';         // File format version (for migration)
  appVersion: string;      // App version that wrote this file (for debugging)
  scene: SerializedScene;
  checksumAlgorithm: typeof PROJECT_CHECKSUM_ALGORITHM;
  checksum: string;
}

interface SerializedScene {
  id: string;
  version: '1.0';
  canvas: Scene['canvas'];
  layers: Layer[];
  objects: SceneObject[];
  material: Scene['material'];
  startPosition: Scene['startPosition'];
  machine?: Scene['machine'];
  compileOptions?: Scene['compileOptions'];
  activeLayerId: string;
  metadata: Scene['metadata'];
}

// ─── SERIALIZE ───────────────────────────────────────────────────

/**
 * Convert a Scene to a JSON string suitable for saving to disk.
 *
 * - Strips transient UI/cache state
 * - Strips cached values (_bounds, _worldTransform)
 * - Wraps in a file envelope with format identifier and version
 * - Pretty-prints with 2-space indent for human readability
 */
export function serializeScene(scene: Scene): string {
  const cleaned = buildSerializedScene(scene);

  const file: SceneFile = {
    format: 'laserforge',
    version: CURRENT_FILE_FORMAT_VERSION,
    appVersion: APP_VERSION,
    scene: cleaned,
    checksumAlgorithm: PROJECT_CHECKSUM_ALGORITHM,
    checksum: buildSceneChecksum(cleaned),
  };

  return JSON.stringify(file, null, 2);
}

function buildSerializedScene(scene: Scene): SerializedScene {
  return {
    id: scene.id,
    version: scene.version,
    canvas: scene.canvas,
    layers: scene.layers,
    objects: scene.objects.map((o) => encodeImageBuffers(stripObjectCache(o))),
    material: scene.material,
    startPosition: scene.startPosition,
    machine: scene.machine,
    compileOptions: scene.compileOptions,
    activeLayerId: scene.activeLayerId,
    metadata: {
      ...scene.metadata,
      modified: new Date().toISOString(),
    },
  };
}

/**
 * Serialize for auto-save (Storage adapter: Electron filesystem or IndexedDB).
 * Same payload shape as file save, compact JSON (no pretty-print). Image pixel
 * data is preserved — unlike historical localStorage autosave, there is no 5MB quota.
 */
export function serializeForAutosave(scene: Scene): string {
  const cleaned = buildSerializedScene(scene);

  const file: SceneFile = {
    format: 'laserforge',
    version: CURRENT_FILE_FORMAT_VERSION,
    appVersion: APP_VERSION,
    scene: cleaned,
    checksumAlgorithm: PROJECT_CHECKSUM_ALGORITHM,
    checksum: buildSceneChecksum(cleaned),
  };

  return JSON.stringify(file);
}

// ─── DESERIALIZE ─────────────────────────────────────────────────

/**
 * Parse a JSON string back into a Scene.
 *
 * - Validates the file envelope (format, version: major 1 loads, major 2+ rejected, 1.x not 1.0 warns and loads best-effort)
 * - Validates required scene fields
 * - Restores runtime defaults (null caches)
 * - Preserves all IDs exactly as saved
 *
 * @throws Error if JSON is invalid or required fields are missing
 */
export function deserializeScene(json: string): Scene {
  return buildSceneFromParsedEnvelope(parseSceneEnvelope(json));
}

export interface DeserializeSceneOptions {
  allowChecksumMismatch?: boolean;
}

export function deserializeSceneWithIntegrity(
  json: string,
  options: DeserializeSceneOptions = {},
): Scene {
  const parsed = parseSceneEnvelope(json);
  const checksum = validateSceneFileChecksum(parsed);
  if (checksum.kind === 'mismatch' && !options.allowChecksumMismatch) {
    throw new ProjectChecksumMismatchError(checksum);
  }
  return buildSceneFromParsedEnvelope(parsed);
}

function parseSceneEnvelope(json: string): any {
  let parsed: any;

  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }

  // Validate file envelope
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid file: expected a JSON object');
  }

  if (parsed.format !== 'laserforge') {
    throw new Error(`Unknown file format: '${parsed.format}' (expected 'laserforge')`);
  }

  const major = fileFormatMajor(parsed.version);
  if (!Number.isFinite(major) || major < 1) {
    throw new Error('Invalid file: format version is missing or not recognized (expected major version 1)');
  }
  if (major > 1) {
    const raw = parsed.version == null || parsed.version === '' ? '(unknown)' : String(parsed.version);
    throw new Error(
      `This project file uses format version ${raw}, which is not supported by this version of LaserForge. Please update the app to open it.`,
    );
  }

  const vDisplay = parsed.version == null || parsed.version === '' ? '1.0' : String(parsed.version);
  const currentMinor = fileFormatMinor(CURRENT_FILE_FORMAT_VERSION);
  const loadedMinor = fileFormatMinor(vDisplay);
  if (Number.isFinite(loadedMinor) && loadedMinor > currentMinor) {
    console.warn(
      `[LaserForge] Loading future file format ${vDisplay} as ${CURRENT_FILE_FORMAT_VERSION}-compatible (best-effort). Re-save the project to normalize the file header.`,
    );
  }

  return parsed;
}

/**
 * T2-74: discriminated kind of repair the deserializer made when
 * loading a project. Each repair is a silent modification the
 * pre-T2-74 path made without telling the user.
 */
export type ProjectRepairKind =
  | 'orphan-objects-relocated'    // object.layerId pointed to a missing layer
  | 'duplicate-objects-removed'   // ≥2 objects shared the same id
  | 'broken-parent-cleared'       // object.parentId pointed to a missing object
  | 'invalid-active-layer';       // scene.activeLayerId pointed to a missing layer

export interface ProjectRepair {
  kind: ProjectRepairKind;
  count: number;
  details?: string;
}

export interface ProjectLoadReport {
  scene: Scene;
  repairs: ProjectRepair[];
}

/**
 * T2-74: variant of `deserializeScene` that returns the loaded
 * scene plus a report of every silent repair the deserializer made.
 * Pre-T2-74 these repairs were silent (or `console.warn` only); a
 * user loading their own project could discover that grouping was
 * dropped or objects were relocated without any signal.
 *
 * The repaired scene is the same shape `deserializeScene` returns —
 * existing callers can keep using `deserializeScene` for the
 * fire-and-forget path; UI consumers that want to show the user
 * what happened call this variant and surface the repair list.
 */
export function deserializeSceneWithReport(json: string): ProjectLoadReport {
  // Reuses the existing deserializer's parse / envelope checks.
  // The build helper now accepts a `repairs` collector that captures
  // each repair as it happens; legacy `deserializeScene` passes
  // undefined and the collector is a no-op.
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid file: expected a JSON object');
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.format !== 'laserforge') {
    throw new Error(`Unknown file format: '${envelope.format}' (expected 'laserforge')`);
  }
  const major = fileFormatMajor(envelope.version);
  if (!Number.isFinite(major) || major < 1) {
    throw new Error('Invalid file: format version is missing or not recognized (expected major version 1)');
  }
  if (major > 1) {
    const raw = envelope.version == null || envelope.version === '' ? '(unknown)' : String(envelope.version);
    throw new Error(
      `This project file uses format version ${raw}, which is not supported by this version of LaserForge. Please update the app to open it.`,
    );
  }

  const repairs: ProjectRepair[] = [];
  const scene = buildSceneFromParsedEnvelope(parsed, repairs);
  return { scene, repairs };
}

// ─── VALIDATION HELPERS ──────────────────────────────────────────

function validateRequired(obj: any, field: string, expectedType: string): void {
  if (obj[field] === undefined || obj[field] === null) {
    throw new Error(`Invalid file: missing required field '${field}'`);
  }
  if (typeof obj[field] !== expectedType) {
    throw new Error(`Invalid file: '${field}' must be ${expectedType}, got ${typeof obj[field]}`);
  }
}

function validateArray(obj: any, field: string): void {
  if (!Array.isArray(obj[field])) {
    throw new Error(`Invalid file: '${field}' must be an array`);
  }
}

/**
 * Validate all 6 transform components are finite numbers.
 * Catches NaN/Infinity from corrupted files before they silently
 * propagate through rendering and toolpath generation.
 */
function validateTransform(t: any, context: string): void {
  const fields = ['a', 'b', 'c', 'd', 'tx', 'ty'];
  for (const f of fields) {
    if (typeof t[f] !== 'number' || !Number.isFinite(t[f])) {
      throw new Error(`Invalid file: transform.${f} in ${context} is not a finite number (got ${t[f]})`);
    }
  }
}

// ─── MIGRATION / ENVELOPE PARSE ──────────────────────────────────

/** Major version number from envelope `version` (e.g. "1.2" → 1). Missing/empty → 1. */
function fileFormatMajor(version: unknown): number {
  if (version == null || version === '') return 1;
  const s = String(version).trim();
  const m = /^(\d+)/.exec(s);
  if (!m) return NaN;
  return parseInt(m[1], 10);
}

function fileFormatMinor(version: unknown): number {
  if (version == null || version === '') return 0;
  const s = String(version).trim();
  const m = /^\d+\.(\d+)/.exec(s);
  if (!m) return 0;
  return parseInt(m[1], 10);
}

/** Shared load path after envelope checks (format laserforge, major version 1). */
function buildSceneFromParsedEnvelope(parsed: any, repairs?: ProjectRepair[]): Scene {
  const s = parsed.scene;
  if (!s || typeof s !== 'object') {
    throw new Error('Invalid file: missing scene data');
  }

  validateRequired(s, 'id', 'string');
  validateRequired(s, 'canvas', 'object');
  validateRequired(s.canvas, 'width', 'number');
  validateRequired(s.canvas, 'height', 'number');
  validateArray(s, 'layers');
  validateArray(s, 'objects');

  if (s.layers.length === 0) {
    throw new Error('Invalid file: scene must have at least one layer');
  }

  for (const layer of s.layers) {
    validateRequired(layer, 'id', 'string');
    validateRequired(layer, 'settings', 'object');
  }

  for (const obj of s.objects) {
    validateRequired(obj, 'id', 'string');
    validateRequired(obj, 'geometry', 'object');
    validateRequired(obj, 'transform', 'object');
    validateTransform(obj.transform, `object '${obj.id || '?'}'`);
  }

  if (!Number.isFinite(s.canvas.width) || !Number.isFinite(s.canvas.height)) {
    throw new Error('Invalid file: canvas dimensions must be finite numbers');
  }

  const scene: Scene = {
    id: s.id,
    version: s.version || '1.0',
    canvas: {
      width: s.canvas.width,
      height: s.canvas.height,
      origin: s.canvas.origin || 'top-left',
      units: s.canvas.units || 'mm',
    },
    layers: s.layers.map((l: any) => restoreLayerDefaults(l)),
    objects: s.objects.map((o: any) => decodeImageBuffers(restoreObjectDefaults(o))),
    material: s.material ?? null,
    startPosition: s.startPosition ?? { x: 0, y: 0 },
    machine: s.machine,
    compileOptions:
      s.compileOptions && typeof s.compileOptions === 'object'
        ? {
            optimizeOrder:
              typeof (s.compileOptions as { optimizeOrder?: unknown }).optimizeOrder === 'boolean'
                ? (s.compileOptions as { optimizeOrder: boolean }).optimizeOrder
                : true,
          }
        : { optimizeOrder: true },
    activeLayerId: s.activeLayerId || s.layers[0].id,
    metadata: {
      name: s.metadata?.name || 'Untitled',
      created: s.metadata?.created || new Date().toISOString(),
      modified: s.metadata?.modified || new Date().toISOString(),
      author: s.metadata?.author || '',
      notes: s.metadata?.notes || '',
      deviceProfileId: s.metadata?.deviceProfileId ?? null,
      // T2-71: pass through if present in the saved JSON. Optional —
      // legacy projects saved before T2-71 omit it and load fine via
      // the no-snapshot path in checkProfileSnapshot.
      ...(s.metadata?.deviceProfileSnapshot
        ? { deviceProfileSnapshot: s.metadata.deviceProfileSnapshot }
        : {}),
      materialPresetId: s.metadata?.materialPresetId ?? null,
    },
  };

  const layerIds = new Set(scene.layers.map(l => l.id));

  // T2-74: track each repair so deserializeSceneWithReport can
  // surface the list to the user.
  if (!layerIds.has(scene.activeLayerId)) {
    const oldId = scene.activeLayerId;
    scene.activeLayerId = scene.layers[0].id;
    repairs?.push({
      kind: 'invalid-active-layer',
      count: 1,
      details: `Active layer "${oldId}" not found; reset to first layer "${scene.layers[0].id}".`,
    });
  }

  let orphanCount = 0;
  for (const obj of scene.objects) {
    if (!layerIds.has(obj.layerId)) {
      obj.layerId = scene.layers[0].id;
      orphanCount++;
    }
  }
  if (orphanCount > 0) {
    repairs?.push({
      kind: 'orphan-objects-relocated',
      count: orphanCount,
      details: `${orphanCount} object(s) referenced layers that no longer exist. They were moved to the default layer.`,
    });
  }

  const objectIds = new Set(scene.objects.map(o => o.id));
  let brokenParentCount = 0;
  for (const obj of scene.objects) {
    if (obj.parentId && !objectIds.has(obj.parentId)) {
      obj.parentId = null;
      brokenParentCount++;
    }
  }
  if (brokenParentCount > 0) {
    repairs?.push({
      kind: 'broken-parent-cleared',
      count: brokenParentCount,
      details: `${brokenParentCount} object(s) referenced a parent group that was removed.`,
    });
  }

  const seenIds = new Set<string>();
  let duplicateCount = 0;
  scene.objects = scene.objects.filter(o => {
    if (seenIds.has(o.id)) {
      duplicateCount++;
      return false;
    }
    seenIds.add(o.id);
    return true;
  });
  if (duplicateCount > 0) {
    repairs?.push({
      kind: 'duplicate-objects-removed',
      count: duplicateCount,
      details: `${duplicateCount} object(s) shared an ID with another object; later duplicates were removed.`,
    });
  }

  if (orphanCount > 0) {
    console.warn(`[LaserForge] Repaired ${orphanCount} object(s) with invalid layer references`);
  }

  return scene;
}

// ─── DEFAULT RESTORATION ─────────────────────────────────────────

function normalizePowerForLayer(rawPower: unknown, defaults: LaserSettings['power']): LaserSettings['power'] {
  if (typeof rawPower === 'number' && Number.isFinite(rawPower)) {
    return { min: 0, max: rawPower };
  }
  if (rawPower && typeof rawPower === 'object') {
    const p = rawPower as { min?: unknown; max?: unknown };
    return {
      min: typeof p.min === 'number' && Number.isFinite(p.min) ? p.min : defaults.min,
      max: typeof p.max === 'number' && Number.isFinite(p.max) ? p.max : defaults.max,
    };
  }
  return { ...defaults };
}

function mergeLayerSettings(raw: unknown, fallbackMode: LayerMode): LaserSettings {
  if (!raw || typeof raw !== 'object') {
    return defaultLaserSettings(fallbackMode);
  }
  const s = raw as Record<string, unknown>;
  const mode = (s.mode as LayerMode) || fallbackMode;
  const base = defaultLaserSettings(mode);

  const fill = { ...base.fill, ...(s.fill && typeof s.fill === 'object' ? (s.fill as object) : {}) };
  const cut = { ...base.cut, ...(s.cut && typeof s.cut === 'object' ? (s.cut as object) : {}) };
  const imageRaw = s.image && typeof s.image === 'object' ? (s.image as Record<string, unknown>) : {};
  const image = { ...base.image, ...imageRaw } as LaserSettings['image'];
  if (imageRaw.imageMode == null || typeof imageRaw.imageMode !== 'string') {
    image.imageMode = image.passThrough === true ? 'grayscale' : 'dither';
  }
  if (typeof image.imageThreshold !== 'number' || !Number.isFinite(image.imageThreshold)) {
    image.imageThreshold = 128;
  }

  const out: LaserSettings = {
    ...base,
    mode,
    power: normalizePowerForLayer(s.power, base.power),
    speed: typeof s.speed === 'number' && Number.isFinite(s.speed) ? s.speed : base.speed,
    passes: typeof s.passes === 'number' && Number.isFinite(s.passes) ? s.passes : base.passes,
    zStepPerPass:
      typeof s.zStepPerPass === 'number' && Number.isFinite(s.zStepPerPass)
        ? s.zStepPerPass
        : base.zStepPerPass,
    fill,
    cut,
    image,
    airAssist: typeof s.airAssist === 'boolean' ? s.airAssist : base.airAssist,
    cutOrder: (s.cutOrder as LaserSettings['cutOrder']) ?? base.cutOrder,
  };

  if (s.tabs && typeof s.tabs === 'object') {
    out.tabs = { enabled: false, count: 0, width: 0, height: 0, ...(s.tabs as object) };
  }

  return out;
}

function restoreLayerDefaults(l: any): Layer {
  const fallbackMode = (l.settings?.mode as LayerMode) || 'cut';
  return {
    id: l.id,
    name: l.name || 'Layer',
    color: l.color || '#3b8beb',
    visible: l.visible !== false,
    locked: l.locked === true,
    output: l.output !== false,
    order: l.order ?? 0,
    settings: mergeLayerSettings(l.settings, fallbackMode),
  };
}

/** Per-geometry migrations applied on every load (e.g. legacy JSON keys). */
function migrateGeometry(geom: unknown): Geometry {
  if (!geom || typeof geom !== 'object') return geom as Geometry;
  const g = geom as Record<string, unknown>;
  if (g.type === 'path' && g._sourceText != null && g.sourceText == null) {
    const { _sourceText, ...rest } = g;
    return { ...rest, sourceText: _sourceText } as Geometry;
  }
  return geom as Geometry;
}

function restoreObjectDefaults(o: any): SceneObject {
  return {
    id: o.id,
    type: o.type || 'path',
    name: o.name || '',
    layerId: o.layerId || '',
    parentId: o.parentId ?? null,
    transform: o.transform,
    geometry: migrateGeometry(o.geometry),
    visible: o.visible !== false,
    locked: o.locked === true,
    powerScale: o.powerScale ?? 1.0,
    cutStartIndex: o.cutStartIndex ?? 0,
    _bounds: null,
    _worldTransform: null,
  };
}

// ─── CACHE STRIPPING ─────────────────────────────────────────────

function stripObjectCache(obj: SceneObject): any {
  const { _bounds, _worldTransform, ...clean } = obj;
  return clean;
}

// ─── BASE64 HELPERS FOR TYPED ARRAYS ────────────────────────────

function uint8ToBase64(arr: Uint8Array): string {
  let binary = '';
  const len = arr.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}

/**
 * Encode Uint8Array image buffers as base64 strings for JSON safety.
 * JSON.stringify turns Uint8Array into {"0":128,"1":64,...} which
 * doesn't reconstruct back on parse. Base64 preserves the data correctly.
 */
function encodeImageBuffers(obj: any): any {
  if (obj.geometry?.type === 'image') {
    const geom = { ...obj.geometry };
    if (geom.grayscaleData instanceof Uint8Array) {
      geom._grayscaleDataB64 = uint8ToBase64(geom.grayscaleData);
      geom._grayscaleDataLength = geom.grayscaleData.length;
      delete geom.grayscaleData;
    }
    if (geom.adjustedData instanceof Uint8Array) {
      geom._adjustedDataB64 = uint8ToBase64(geom.adjustedData);
      geom._adjustedDataLength = geom.adjustedData.length;
      delete geom.adjustedData;
    }
    return { ...obj, geometry: geom };
  }
  return obj;
}

/**
 * Decode base64 image buffers back into Uint8Arrays on load.
 * Also handles legacy files where Uint8Array was serialized as a plain object.
 */
function decodeImageBuffers(obj: any): any {
  if (obj.geometry?.type === 'image') {
    const geom = obj.geometry;

    // Decode base64 encoded buffers (new format)
    if (geom._grayscaleDataB64 && typeof geom._grayscaleDataB64 === 'string') {
      geom.grayscaleData = base64ToUint8(geom._grayscaleDataB64);
      delete geom._grayscaleDataB64;
      delete geom._grayscaleDataLength;
    }
    if (geom._adjustedDataB64 && typeof geom._adjustedDataB64 === 'string') {
      geom.adjustedData = base64ToUint8(geom._adjustedDataB64);
      delete geom._adjustedDataB64;
      delete geom._adjustedDataLength;
    }

    // Previous laserforge saves used _grayscaleB64 / _adjustedB64
    if (geom._grayscaleB64 && typeof geom._grayscaleB64 === 'string') {
      geom.grayscaleData = base64ToUint8(geom._grayscaleB64);
      delete geom._grayscaleB64;
    }
    if (geom._adjustedB64 && typeof geom._adjustedB64 === 'string') {
      geom.adjustedData = base64ToUint8(geom._adjustedB64);
      delete geom._adjustedB64;
    }

    // Handle legacy files where Uint8Array became a plain object {"0":128,"1":64,...}
    if (geom.grayscaleData && !(geom.grayscaleData instanceof Uint8Array) && typeof geom.grayscaleData === 'object') {
      const values = Object.values(geom.grayscaleData) as number[];
      geom.grayscaleData = new Uint8Array(values);
    }
    if (geom.adjustedData && !(geom.adjustedData instanceof Uint8Array) && typeof geom.adjustedData === 'object') {
      const values = Object.values(geom.adjustedData) as number[];
      geom.adjustedData = new Uint8Array(values);
    }
  }
  return obj;
}
