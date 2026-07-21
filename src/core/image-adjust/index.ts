// Image Studio adjustments core (Phase L, ADR-242, parity plan PP-E) — pure
// tone-mapping primitives for the editor's Adjust menu: per-channel and luma
// LUT application (selection-clamped, feather-aware), the LUT builders
// (brightness/contrast, invert, posterize, threshold, grayscale, levels,
// curves), and the luma histogram the Levels/Curves dialogs render.
//
// The barrel is curated (new-barrel cap: 20 exports). UI imports only this
// surface; intra-module code and tests import the leaf files directly.

export { applyLutInPlace, applyLumaLutInPlace } from './lut';

export {
  brightnessContrastLut,
  grayscaleLut,
  invertLut,
  posterizeLut,
  thresholdLut,
} from './tone-luts';

export type { LevelsParams } from './levels';
export { IDENTITY_LEVELS, levelsLut } from './levels';

export type { CurvePoint } from './curves';
export { curveLut } from './curves';

export { lumaHistogram } from './histogram';
