/**
 * === FILE: /src/core/scene/Layer.ts ===
 * 
 * Purpose:    Defines the Layer model. In LaserForge, a Layer is NOT
 *             just visual grouping — it IS a processing rule. Each layer
 *             carries the laser settings (power, speed, mode) that
 *             determine how every object on that layer gets manufactured.
 * Dependencies: /src/core/types.ts
 * Last updated: Phase 1, Step 1 — Foundation
 */

import { generateId } from '../types';
import { type ScanningOffsetTable } from '../plan/ScanningOffset';

// ─── LAYER COLORS ────────────────────────────────────────────────

export const LAYER_COLORS = [
  '#E63E6D', // Red-pink (cut)
  '#3B8BEB', // Blue (engrave)
  '#2DD4A0', // Green (score)
  '#F0B429', // Yellow (image)
  '#9B6DFF', // Purple
  '#22D3EE', // Cyan
  '#F07C42', // Orange
  '#EF4444', // Red
] as const;

// ─── PROCESSING MODES ────────────────────────────────────────────

export type LayerMode = 'cut' | 'engrave' | 'score' | 'image';

/** How raster image pixels become laser power / 1-bit output. */
export type ImageRasterMode = 'dither' | 'grayscale' | 'threshold';

export type FillMode = 'line' | 'offset' | 'cross-hatch';

export type DitherMode =
  | 'none'
  | 'threshold'
  | 'floyd-steinberg'
  | 'jarvis'
  | 'stucki'
  | 'ordered'
  | 'atkinson'
  | 'burkes'
  | 'sierra3'
  | 'sierra2'
  | 'sierra-lite'
  | 'random';

export type CutOrder = 'layer-priority' | 'object-order' | 'optimized';

// ─── LASER SETTINGS ──────────────────────────────────────────────

export interface LaserSettings {
  mode: LayerMode;

  power: {
    min: number;   // 0–100%
    max: number;   // 0–100%
  };
  speed: number;   // mm/min
  passes: number;  // 1–99
  zStepPerPass: number;  // mm, focus offset per pass

  // Fill settings (engrave mode)
  fill: {
    enabled: boolean;
    interval: number;       // mm spacing between scanlines
    angle: number;          // degrees
    mode: FillMode;
    biDirectional: boolean;
    overscanning: number;   // mm overshoot for acceleration
  };

  // Cut settings
  cut: {
    overcut: number;        // mm past start on closed paths
    leadIn: number;         // mm acceleration lead-in
    tabCount: number;       // hold-down tabs
    tabWidth: number;       // mm per tab
    insideFirst: boolean;   // cut inner shapes before outer
  };

  /**
   * Beginner "keep parts attached" — when `enabled`, job compiler uses these
   * instead of `cut.tabCount` / `cut.tabWidth`. `height` is informational (mm bridge depth).
   */
  tabs?: {
    enabled: boolean;
    count: number;
    width: number;
    height: number;
  };

  // Image settings
  image: {
    imageMode: ImageRasterMode;
    /** Used when `imageMode === 'threshold'`, and as default threshold for dither `threshold` algorithm. */
    imageThreshold: number;
    dithering: DitherMode;
    resolution: number;     // DPI
    brightness: number;     // -100 to 100
    contrast: number;       // -100 to 100
    gamma: number;          // 0.1 to 5.0
    invert: boolean;
    /** @deprecated Use `imageMode === 'grayscale'` instead. */
    passThrough: boolean;
  };

  // Hardware
  airAssist: boolean;
  cutOrder: CutOrder;

  /** Image/raster: scale power during accel/decel (default true via resolve). */
  accelAwarePower?: boolean;
  /** Minimum laser power ratio during decel phases (0–1). */
  minPowerRatioAccel?: number;

  /** When true, apply scanning offset table (layer or device profile). */
  useScanOffsets?: boolean;
  /** Per-layer scanning offset table; overrides device profile when non-empty. */
  scanningOffsets?: ScanningOffsetTable;

  /** When true (default), overscan is computed from speed and machine acceleration. */
  smartOverscanEnabled?: boolean;

  /**
   * When set, this layer is linked to the MaterialPreset with this id.
   * JobCompiler reads the preset (via MaterialLibrary.getPresetById) to
   * fetch compile-time fields like responseCurve / kerf / zOffset.
   * OPTIONAL.
   */
  materialPresetId?: string;
  /**
   * T2-72: snapshot of the material preset's compile-relevant fields
   * at the moment the preset was applied. Pre-T2-72 a layer kept only
   * `materialPresetId`; if the user updated the preset library after
   * save (changed power/speed values), reloading the project compiled
   * the layer against the NEW preset values silently. The snapshot
   * captures the as-applied values so the load-time mismatch detector
   * (`checkPresetSnapshot`) can offer the user a choice. Optional —
   * legacy projects ride forward via the `no-snapshot` path. Mirror
   * of T2-71's `Scene.metadata.deviceProfileSnapshot` pattern.
   */
  materialPresetSnapshot?: import('../materials/MaterialPresetSnapshot').MaterialPresetSnapshot;
  /**
   * T2-59: user-facing confidence for the power/speed/pass values currently
   * on this layer. This distinguishes built-in tested presets from user-saved,
   * estimated, and manual-unverified values without changing compile output.
   */
  settingsConfidence?: import('../materials/MaterialSettingConfidence').LayerSettingsConfidence;
}

// ─── LAYER ───────────────────────────────────────────────────────

export interface Layer {
  readonly id: string;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  output: boolean;   // Include in job output?
  order: number;     // Processing order (NOT z-order)

  settings: LaserSettings;
}

// ─── DEFAULT SETTINGS ────────────────────────────────────────────

export function defaultLaserSettings(mode: LayerMode = 'cut'): LaserSettings {
  return {
    mode,
    power: { min: 0, max: mode === 'cut' ? 80 : mode === 'engrave' ? 50 : mode === 'image' ? 70 : 15 },
    speed: mode === 'cut' ? 150 : mode === 'engrave' ? 3000 : mode === 'image' ? 800 : 2200,
    passes: 1,
    zStepPerPass: 0,
    fill: {
      enabled: mode === 'engrave' || mode === 'image',
      interval: 0.1,
      angle: 0,
      mode: 'line',
      biDirectional: true,
      overscanning: 2.5,
    },
    cut: {
      overcut: 0,
      leadIn: 0,
      tabCount: 0,
      tabWidth: 5,
      insideFirst: true,
    },
    image: {
      imageMode: 'dither',
      imageThreshold: 128,
      dithering: 'floyd-steinberg',
      resolution: 254,  // ~0.1mm dot pitch
      brightness: 0,
      contrast: 0,
      gamma: 1.0,
      invert: false,
      passThrough: false,
    },
    airAssist: mode === 'cut',
    cutOrder: 'optimized',
  };
}

// ─── FACTORY ─────────────────────────────────────────────────────

export function createLayer(
  index: number,
  mode: LayerMode = 'cut',
  name?: string
): Layer {
  return {
    id: generateId(),
    name: name || `Layer ${index}`,
    color: LAYER_COLORS[index % LAYER_COLORS.length],
    visible: true,
    locked: false,
    output: true,
    order: index,
    settings: defaultLaserSettings(mode),
  };
}

// ─── PROCESSING ORDER ────────────────────────────────────────────
// Engrave before cut — otherwise the part falls out and engraving misaligns.

const MODE_PRIORITY: Record<LayerMode, number> = {
  engrave: 0,
  image: 1,
  score: 2,
  cut: 3,
};

export function sortLayersByProcessingOrder(layers: Layer[]): Layer[] {
  return [...layers].sort((a, b) => {
    const pa = MODE_PRIORITY[a.settings.mode];
    const pb = MODE_PRIORITY[b.settings.mode];
    if (pa !== pb) return pa - pb;
    return a.order - b.order;
  });
}
