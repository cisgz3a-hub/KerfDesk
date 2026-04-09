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
import { type SceneObject } from '../core/scene/SceneObject';
import { type Layer } from '../core/scene/Layer';

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

// ─── TYPED ARRAY ENCODING ───────────────────────────────────────

function uint8ToBase64(arr: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
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
    objects: scene.objects.map(stripObjectCache),
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

// ─── DESERIALIZE ─────────────────────────────────────────────────

/**
 * Parse a JSON string back into a Scene.
 *
 * - Validates the file envelope (format, version)
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

  // Version check with migration path
  if (parsed.version !== '1.0') {
    return migrateScene(parsed);
  }

  const s = parsed.scene;
  if (!s || typeof s !== 'object') {
    throw new Error('Invalid file: missing scene data');
  }

  // Validate required fields
  validateRequired(s, 'id', 'string');
  validateRequired(s, 'canvas', 'object');
  validateRequired(s.canvas, 'width', 'number');
  validateRequired(s.canvas, 'height', 'number');
  validateArray(s, 'layers');
  validateArray(s, 'objects');

  if (s.layers.length === 0) {
    throw new Error('Invalid file: scene must have at least one layer');
  }

  // Validate each layer has an id
  for (const layer of s.layers) {
    validateRequired(layer, 'id', 'string');
    validateRequired(layer, 'settings', 'object');
  }

  // Validate each object has an id and geometry
  for (const obj of s.objects) {
    validateRequired(obj, 'id', 'string');
    validateRequired(obj, 'geometry', 'object');
    validateRequired(obj, 'transform', 'object');
    validateTransform(obj.transform, `object '${obj.id || '?'}'`);
  }

  // Validate canvas dimensions are finite
  if (!Number.isFinite(s.canvas.width) || !Number.isFinite(s.canvas.height)) {
    throw new Error('Invalid file: canvas dimensions must be finite numbers');
  }

  // Reconstruct Scene with transient defaults
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
    objects: s.objects.map((o: any) => restoreObjectDefaults(o)),
    material: s.material ?? null,
    startPosition: s.startPosition ?? { x: 0, y: 0 },
    machine: s.machine,
    selection: [],              // Transient: always empty on load
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

  return scene;
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

// ─── MIGRATION ───────────────────────────────────────────────────

/**
 * Migrate files from older format versions.
 * Currently no older versions exist, so this always throws.
 * When version '1.1' is introduced, add a migration path here.
 */
function migrateScene(file: any): Scene {
  throw new Error(`Unsupported file version: '${file.version}' (expected '1.0'). No migration available.`);
}

// ─── DEFAULT RESTORATION ─────────────────────────────────────────

function restoreLayerDefaults(l: any): Layer {
  return {
    id: l.id,
    name: l.name || 'Layer',
    color: l.color || '#3b8beb',
    visible: l.visible !== false,
    locked: l.locked === true,
    output: l.output !== false,
    order: l.order ?? 0,
    settings: l.settings,
  };
}

function restoreObjectDefaults(o: any): SceneObject {
  // Decode base64 image buffers back to Uint8Array
  if (o.geometry?.type === 'image') {
    const geom = o.geometry;
    if (geom._grayscaleB64) {
      geom.grayscaleData = base64ToUint8(geom._grayscaleB64);
      delete geom._grayscaleB64;
    }
    if (geom._adjustedB64) {
      geom.adjustedData = base64ToUint8(geom._adjustedB64);
      delete geom._adjustedB64;
    }
  }

  return {
    id: o.id,
    type: o.type || 'path',
    name: o.name || '',
    layerId: o.layerId || '',
    parentId: o.parentId ?? null,
    transform: o.transform,
    geometry: o.geometry,
    visible: o.visible !== false,
    locked: o.locked === true,
    powerScale: o.powerScale ?? 1.0,
    _bounds: null,
    _worldTransform: null,
  };
}

// ─── CACHE STRIPPING ─────────────────────────────────────────────

function stripObjectCache(obj: SceneObject): any {
  const { _bounds, _worldTransform, ...clean } = obj;

  // Encode Uint8Array fields as base64 for JSON safety
  if (clean.geometry?.type === 'image') {
    const geom = { ...clean.geometry };
    if (geom.grayscaleData instanceof Uint8Array) {
      (geom as any)._grayscaleB64 = uint8ToBase64(geom.grayscaleData);
      delete geom.grayscaleData;
    }
    if ((geom as any).adjustedData instanceof Uint8Array) {
      (geom as any)._adjustedB64 = uint8ToBase64((geom as any).adjustedData);
      delete (geom as any).adjustedData;
    }
    return { ...clean, geometry: geom };
  }

  return clean;
}
