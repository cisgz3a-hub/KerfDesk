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
import { type SceneObject, type Geometry, type ImageGeometry } from '../core/scene/SceneObject';
import { type Layer } from '../core/scene/Layer';
import { defaultLaserSettings, type LaserSettings, type LayerMode } from '../core/scene/Layer';

// ─── FILE FORMAT ─────────────────────────────────────────────────

const APP_VERSION = '0.1.0';

interface SceneFile {
  format: 'laserforge';
  version: '1.0';         // File format version (for migration)
  appVersion: string;      // App version that wrote this file (for debugging)
  scene: SerializedScene;
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
  activeLayerId: string;
  metadata: Scene['metadata'];
}

// ─── SERIALIZE ───────────────────────────────────────────────────

/**
 * Convert a Scene to a JSON string suitable for saving to disk.
 *
 * - Strips transient UI state (selection)
 * - Strips cached values (_bounds, _worldTransform)
 * - Wraps in a file envelope with format identifier and version
 * - Pretty-prints with 2-space indent for human readability
 */
export function serializeScene(scene: Scene): string {
  const cleaned: SerializedScene = {
    id: scene.id,
    version: scene.version,
    canvas: scene.canvas,
    layers: scene.layers,
    objects: scene.objects.map((o) => encodeImageBuffers(stripObjectCache(o))),
    material: scene.material,
    startPosition: scene.startPosition,
    machine: scene.machine,
    activeLayerId: scene.activeLayerId,
    metadata: {
      ...scene.metadata,
      modified: new Date().toISOString(),
    },
  };

  const file: SceneFile = {
    format: 'laserforge',
    version: '1.0',
    appVersion: APP_VERSION,
    scene: cleaned,
  };

  return JSON.stringify(file, null, 2);
}

/**
 * Serialize for localStorage auto-save only: strips heavy image pixel buffers so
 * quota is not exhausted. Full `serializeScene` is still used for file export.
 */
export function serializeForAutosave(scene: Scene): string {
  const cleaned: SerializedScene = {
    id: scene.id,
    version: scene.version,
    canvas: scene.canvas,
    layers: scene.layers,
    objects: scene.objects.map((o) =>
      encodeImageBuffers(stripObjectCache(stripImageBuffersForAutosave(o))),
    ),
    material: scene.material,
    startPosition: scene.startPosition,
    machine: scene.machine,
    activeLayerId: scene.activeLayerId,
    metadata: {
      ...scene.metadata,
      modified: new Date().toISOString(),
    },
  };

  const file: SceneFile = {
    format: 'laserforge',
    version: '1.0',
    appVersion: APP_VERSION,
    scene: cleaned,
  };

  return JSON.stringify(file);
}

// ─── DESERIALIZE ─────────────────────────────────────────────────

/**
 * Parse a JSON string back into a Scene.
 *
 * - Validates the file envelope (format, version: major 1 loads, major 2+ rejected, 1.x not 1.0 warns and loads best-effort)
 * - Validates required scene fields
 * - Restores transient state defaults (empty selection, null caches)
 * - Preserves all IDs exactly as saved
 *
 * @throws Error if JSON is invalid or required fields are missing
 */
export function deserializeScene(json: string): Scene {
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
  if (vDisplay !== '1.0') {
    console.warn(
      `[LaserForge] Loading file format ${vDisplay} as 1.0-compatible (best-effort). Re-save the project to normalize the file header.`,
    );
  }

  return buildSceneFromParsedEnvelope(parsed);
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

/** Shared load path after envelope checks (format laserforge, major version 1). */
function buildSceneFromParsedEnvelope(parsed: any): Scene {
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
    selection: [],
    activeLayerId: s.activeLayerId || s.layers[0].id,
    metadata: {
      name: s.metadata?.name || 'Untitled',
      created: s.metadata?.created || new Date().toISOString(),
      modified: s.metadata?.modified || new Date().toISOString(),
      author: s.metadata?.author || '',
      notes: s.metadata?.notes || '',
      deviceProfileId: s.metadata?.deviceProfileId ?? null,
      materialPresetId: s.metadata?.materialPresetId ?? null,
    },
  };

  const layerIds = new Set(scene.layers.map(l => l.id));

  if (!layerIds.has(scene.activeLayerId)) {
    scene.activeLayerId = scene.layers[0].id;
  }

  let orphanCount = 0;
  for (const obj of scene.objects) {
    if (!layerIds.has(obj.layerId)) {
      obj.layerId = scene.layers[0].id;
      orphanCount++;
    }
  }

  const objectIds = new Set(scene.objects.map(o => o.id));
  for (const obj of scene.objects) {
    if (obj.parentId && !objectIds.has(obj.parentId)) {
      obj.parentId = null;
    }
  }

  const seenIds = new Set<string>();
  scene.objects = scene.objects.filter(o => {
    if (seenIds.has(o.id)) return false;
    seenIds.add(o.id);
    return true;
  });

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
  const image = { ...base.image, ...(s.image && typeof s.image === 'object' ? (s.image as object) : {}) };

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

function stripImageBuffersForAutosave(obj: SceneObject): SceneObject {
  if (obj.geometry?.type !== 'image') return obj;
  const g = obj.geometry as unknown as Record<string, unknown>;
  const {
    grayscaleData: _gd,
    adjustedData: _ad,
    _grayscaleDataB64: _g64,
    _adjustedDataB64: _a64,
    _grayscaleDataLength: _gl,
    _adjustedDataLength: _al,
    _grayscaleB64: _gleg,
    _adjustedB64: _aleg,
    ...rest
  } = g;
  return { ...obj, geometry: rest as unknown as ImageGeometry };
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
