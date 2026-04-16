/**
 * === FILE: /src/core/job/Job.ts ===
 * 
 * Purpose:    The Job is Stage 1 of the pipeline: Scene → Job.
 *             A Job is a MACHINE-AGNOSTIC description of what needs
 *             to happen. It's compiled from the scene graph + layer
 *             settings. Once compiled, it has NO reference back to
 *             the scene. This is the key decoupling point.
 * 
 * Pipeline:   Scene → [compileJob] → Job → [optimizePlan] → Plan → [generateOutput] → Output
 * 
 * Dependencies:
 *   - /src/core/types.ts
 *   - /src/core/scene/Layer.ts (for ResolvedLaserSettings derivation)
 * Last updated: Phase 1, Step 1 — Foundation
 */

import { type AABB, type Point, emptyAABB, generateId } from '../types';
import { type FillMode, type ImageRasterMode } from '../scene/Layer';

// ─── OPERATION TYPE ──────────────────────────────────────────────

export type OperationType = 'cut' | 'engrave' | 'score' | 'raster';

// ─── FLAT PATH ───────────────────────────────────────────────────
/**
 * A FlatPath is geometry stripped of ALL scene graph overhead.
 * Just coordinates in world space. Ready for toolpath generation.
 * 
 * coords is a flat Float64Array: [x0, y0, x1, y1, x2, y2, ...]
 * This format is optimal for:
 *   - Zero-copy transfer to WASM
 *   - Direct Canvas2D rendering via Path2D
 *   - Minimal memory footprint
 */
export interface FlatPath {
  id: string;                    // Traceability back to source object
  coords: Float64Array;          // [x0, y0, x1, y1, ...] world coordinates
  closed: boolean;
  direction: 'cw' | 'ccw';      // Winding (for inside-first ordering)
  bounds: AABB;
  parentId: string | null;       // For containment hierarchy
  /** Multiplier on layer max power (from SceneObject.powerScale). */
  powerScale: number;
}

// ─── PROCESSED BITMAP ────────────────────────────────────────────
/**
 * Raster image data after processing pipeline:
 * Raw Image → brightness/contrast/gamma/invert (on a copy) → dither | grayscale | threshold → ProcessedBitmap
 */
export interface ProcessedBitmap {
  width: number;                 // pixels
  height: number;                // pixels
  dpi: number;
  /** 1-bit mask, or 8-bit luminance (0=dark, 255=light) for variable-S raster. */
  mode: '1bit' | 'grayscale';
  data: Uint8Array;

  physicalWidth: number;         // mm on bed (must match bitmap pixel pitch: physicalWidth/width)
  physicalHeight: number;        // mm on bed (physicalHeight/height)
  position: Point;               // world coordinates of top-left corner

  pipeline: {
    brightness: number;
    contrast: number;
    gamma: number;
    ditheringMode: string;
    inverted: boolean;
    imageMode?: ImageRasterMode;
    imageThreshold?: number;
  };
}

// ─── OPERATION GEOMETRY ──────────────────────────────────────────

export type OperationGeometry =
  | { type: 'vector'; paths: FlatPath[] }      // cut, score, engrave outlines
  | { type: 'fill';   paths: FlatPath[] }      // engrave fill boundaries
  | { type: 'raster'; bitmap: ProcessedBitmap }; // image engraving

// ─── RESOLVED LASER SETTINGS ─────────────────────────────────────
/**
 * Fully resolved — no nulls, no defaults, no inheritance.
 * Every value is explicitly set. The toolpath engine reads ONLY this.
 */
export interface ResolvedLaserSettings {
  powerMin: number;              // 0–100
  powerMax: number;              // 0–100
  speed: number;                 // mm/min (already converted)
  passes: number;
  zStepPerPass: number;          // mm

  fillInterval: number;          // mm (0 if not fill mode)
  fillAngle: number;             // degrees
  fillMode: FillMode;
  fillBiDirectional: boolean;
  overscanning: number;          // mm

  overcut: number;               // mm
  leadIn: number;                // mm
  tabCount: number;
  tabWidth: number;              // mm
  insideFirst: boolean;

  airAssist: boolean;

  /** Raster: scale laser power with trapezoidal velocity (reduces dark scan ends). */
  accelAwarePower: boolean;
  /** Max acceleration mm/s² for velocity profile (from profile or GRBL $120/$121). */
  maxAccelMmPerS2: number;
  /** Minimum power ratio during decel (0–1). */
  minPowerRatioAccel: number;
}

// ─── OPERATION ───────────────────────────────────────────────────
/**
 * One processing unit — one layer's worth of work.
 * Contains all resolved geometry and settings needed for toolpath generation.
 */
export interface Operation {
  id: string;
  layerId: string;               // For UI highlighting only
  layerName: string;
  layerColor: string;
  order: number;                 // Processing order

  type: OperationType;
  settings: ResolvedLaserSettings;
  geometry: OperationGeometry;

  bounds: AABB;
}

// ─── JOB ─────────────────────────────────────────────────────────
/**
 * A Job is the complete, machine-agnostic description of a laser job.
 * It is compiled from the Scene and is immutable once created.
 */
export interface Job {
  readonly id: string;
  name: string;
  createdAt: string;

  operations: Operation[];
  bounds: AABB;                  // Union of all operation bounds

  metadata: {
    objectCount: number;
    layerCount: number;
    sourceProjectId: string;
    startPositionX?: number;
    startPositionY?: number;
  };
}

// ─── FACTORY ─────────────────────────────────────────────────────

export function createEmptyJob(name: string, sourceProjectId: string): Job {
  return {
    id: generateId(),
    name,
    createdAt: new Date().toISOString(),
    operations: [],
    bounds: emptyAABB(),
    metadata: {
      objectCount: 0,
      layerCount: 0,
      sourceProjectId,
    },
  };
}

// ─── FLAT PATH HELPERS ───────────────────────────────────────────

export function flatPathFromPoints(
  points: Point[],
  closed: boolean,
  sourceId: string,
  powerScale: number = 1.0
): FlatPath {
  const coords = new Float64Array(points.length * 2);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (let i = 0; i < points.length; i++) {
    const x = points[i].x;
    const y = points[i].y;
    coords[i * 2] = x;
    coords[i * 2 + 1] = y;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    id: sourceId,
    coords,
    closed,
    direction: computeWinding(coords) >= 0 ? 'ccw' : 'cw',
    bounds: { minX, minY, maxX, maxY },
    parentId: null,
    powerScale,
  };
}

/**
 * Compute signed area to determine winding direction.
 * Positive = counter-clockwise, Negative = clockwise.
 */
function computeWinding(coords: Float64Array): number {
  let sum = 0;
  const n = coords.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += (coords[j * 2] - coords[i * 2]) * (coords[j * 2 + 1] + coords[i * 2 + 1]);
  }
  return sum;
}
