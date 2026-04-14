/**
 * === FILE: /src/core/scene/Scene.ts ===
 * 
 * Purpose:    The root document model. Contains all objects, layers,
 *             and project settings. This is what gets saved/loaded.
 *             The Scene is the SINGLE SOURCE OF TRUTH for the design.
 * Dependencies:
 *   - /src/core/types.ts
 *   - /src/core/scene/SceneObject.ts
 *   - /src/core/scene/Layer.ts
 * Last updated: Phase 1, Step 1 — Foundation
 */

import { type Units, type Origin, generateId } from '../types';
import { type SceneObject } from './SceneObject';
import { type Layer, createLayer } from './Layer';

// ─── PROJECT DOCUMENT ────────────────────────────────────────────

export interface Scene {
  readonly id: string;
  version: '1.0';

  // Canvas / workspace
  canvas: {
    width: number;       // mm — matches machine bed
    height: number;      // mm
    origin: Origin;
    units: Units;
  };

  // Content — each Layer.settings includes passes (default 1), power, speed, mode; see Layer.LaserSettings
  layers: Layer[];
  objects: SceneObject[];
  material: {
    type: 'wood' | 'acrylic' | 'leather' | 'paper' | 'fabric' | 'cardboard' | 'metal' | 'custom';
    name: string;           // e.g. "3mm Birch Plywood"
    width: number;          // mm
    height: number;         // mm
    x: number;              // position on bed (mm from left)
    y: number;              // position on bed (mm from top)
    thickness: number;      // mm
    color: string;          // display color
    /** When false, material / result preview is disabled. Omitted = enabled. */
    enabled?: boolean;
  } | null;

  /** Laser start position */
  startPosition: {
    x: number;
    y: number;
  };

  /** Selected machine from welcome setup (optional) */
  machine?: {
    name: string;
    watts: string;
    type: string; // 'diode' | 'co2' | 'fiber'
  };

  activeLayerId: string;     // Currently active layer

  // Project metadata
  metadata: {
    name: string;
    created: string;         // ISO 8601
    modified: string;
    author: string;
    notes: string;
    deviceProfileId: string | null;
    materialPresetId: string | null;
  };
}

// ─── FACTORY ─────────────────────────────────────────────────────

export function createScene(
  bedWidth: number = 400,
  bedHeight: number = 400,
  name: string = 'Untitled Project'
): Scene {
  const defaultLayer = createLayer(0, 'cut', 'Cut');

  return {
    id: generateId(),
    version: '1.0',
    canvas: {
      width: bedWidth,
      height: bedHeight,
      origin: 'top-left',
      units: 'mm',
    },
    layers: [defaultLayer],
    objects: [],
    material: null,
    startPosition: { x: 0, y: 0 },
    activeLayerId: defaultLayer.id,
    metadata: {
      name,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      author: '',
      notes: '',
      deviceProfileId: null,
      materialPresetId: null,
    },
  };
}

// ─── QUERY HELPERS ───────────────────────────────────────────────

export function getObjectById(scene: Scene, id: string): SceneObject | undefined {
  return scene.objects.find(o => o.id === id);
}

export function getLayerById(scene: Scene, id: string): Layer | undefined {
  return scene.layers.find(l => l.id === id);
}

export function getObjectsByLayer(scene: Scene, layerId: string): SceneObject[] {
  return scene.objects.filter(o => o.layerId === layerId);
}

export function getActiveLayer(scene: Scene): Layer | undefined {
  return scene.layers.find(l => l.id === scene.activeLayerId);
}

export function getVisibleLayers(scene: Scene): Layer[] {
  return scene.layers.filter(l => l.visible);
}

export function getOutputLayers(scene: Scene): Layer[] {
  return scene.layers.filter(l => l.visible && l.output);
}
