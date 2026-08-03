// wood-view-palettes — the standalone preview's wood species, groove fills and
// camera presets, ported verbatim (ADR-285).
//
// The swatches are written as sRGB the way a paint chip is quoted; the shader
// integrates light linearly and gamma-encodes at the end, so they are
// linearised on upload. Feeding sRGB straight in washes every species out to
// the same pale tan.
//
// PURE: constants and one conversion. No WebGL, no DOM.

export type WoodSpecies = {
  readonly early: readonly [number, number, number];
  readonly late: readonly [number, number, number];
  readonly ringFreq: number;
  readonly sharp: number;
  readonly warp: number;
  readonly pore: number;
  readonly fresh: number;
};

export type CameraPreset = {
  readonly az: number;
  readonly el: number;
  readonly dist: number;
};

export const WOOD_SPECIES: Readonly<Record<string, WoodSpecies>> = {
  Maple: {
    early: [0.86, 0.78, 0.65],
    late: [0.76, 0.67, 0.55],
    ringFreq: 0.55,
    sharp: 4,
    warp: 1.8,
    pore: 0.12,
    fresh: 1.1,
  },
  Cherry: {
    early: [0.72, 0.53, 0.41],
    late: [0.53, 0.36, 0.27],
    ringFreq: 0.4,
    sharp: 3.2,
    warp: 2.4,
    pore: 0.25,
    fresh: 1.16,
  },
  Oak: {
    early: [0.75, 0.63, 0.49],
    late: [0.53, 0.43, 0.32],
    ringFreq: 0.3,
    sharp: 2.6,
    warp: 2.8,
    pore: 0.75,
    fresh: 1.14,
  },
  Walnut: {
    early: [0.42, 0.34, 0.29],
    late: [0.23, 0.17, 0.14],
    ringFreq: 0.42,
    sharp: 3,
    warp: 2.6,
    pore: 0.45,
    fresh: 1.3,
  },
};

/** null = bare cut; otherwise the sRGB colour packed into the groove. */
export const GROOVE_FILLS: Readonly<Record<string, readonly [number, number, number] | null>> = {
  'Bare cut': null,
  'Black paint': [0.035, 0.033, 0.032],
  'Gold leaf': [0.78, 0.58, 0.19],
  'White paint': [0.88, 0.87, 0.84],
};

export const CAMERA_PRESETS: Readonly<Record<string, CameraPreset>> = {
  Hero: { az: -0.62, el: 0.62, dist: 1.3 },
  Raking: { az: -1.15, el: 0.28, dist: 1.18 },
  Top: { az: 0, el: 1.5006, dist: 1.16 },
  Macro: { az: -0.5, el: 0.4, dist: 0.55 },
};

export const DEFAULT_SPECIES = 'Walnut';
export const DEFAULT_FILL = 'Bare cut';
export const DEFAULT_VIEW = 'Hero';
export const DEFAULT_LIGHT_AZIMUTH_DEG = 135;

/**
 * Converts an sRGB swatch to the linear values the shader integrates.
 *
 * @param rgb The sRGB triple, each component 0..1.
 * @returns The same colour in linear space.
 */
export function linearizeSrgb(rgb: readonly [number, number, number]): [number, number, number] {
  return [Math.pow(rgb[0], 2.2), Math.pow(rgb[1], 2.2), Math.pow(rgb[2], 2.2)];
}
