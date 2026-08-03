// wood-grain-appearance — how each timber stock's grain is figured in the 3D
// viewport (ADR-284).
//
// Separate from material-appearance.ts on purpose: that table answers "what
// colour and finish is this stock", which BOTH previews need, while this one
// answers "how does its grain run", which only the WebGL surface can express.
// Folding these fields into the shared factory would have pushed it past the
// four-parameter limit and handed the Canvas2D path numbers it cannot use.
//
// A null grain means "not timber" — acrylic and aluminium keep the original
// depth-ramped vertex colours rather than being given wood figure.
//
// PURE: a key in, constants out. No three import.

import { CHIPLOAD_MATERIALS, type ChiploadMaterial } from '../../core/cnc';

export type GrainAppearance = {
  // Growth rings per mm of ring coordinate. Real rings run roughly 2-8 mm
  // apart, so anything below ~0.15 puts less than one ring across the stock.
  readonly ringFreq: number;
  // Exponent on the ring band. Higher = narrower, harder latewood lines.
  readonly sharp: number;
  // How far the rings wander, in mm. Zero gives machine-straight stripes.
  readonly warp: number;
  // Open-pore strength; oak-like woods show pronounced flecking, maple none.
  readonly pore: number;
  // Albedo multiplier for freshly cut faces. A sawn or carved face is raw
  // fibre against a sanded, sealed top, so it reads lighter.
  readonly fresh: number;
  // How far the latewood colour travels from the stock's shallow tone toward
  // its deep tone. Those two are a DEPTH ramp, so using them undiluted would
  // make every ring look like a pocket.
  readonly contrast: number;
};

const GRAIN_BY_FAMILY: Record<string, GrainAppearance | null> = {
  // Softwood: wide, high-contrast rings and very pale earlywood.
  softwood: { ringFreq: 0.3, sharp: 3, warp: 2.6, pore: 0.2, fresh: 1.14, contrast: 0.55 },
  // Hardwood: tighter figure, stronger pores, cut faces noticeably lighter.
  hardwood: { ringFreq: 0.42, sharp: 3.4, warp: 2.4, pore: 0.45, fresh: 1.26, contrast: 0.5 },
  // MDF has no grain at all; plywood shows only a faint face veneer. Near-flat
  // figure, and the cut face barely brightens because it is the same dust.
  'plywood-mdf': { ringFreq: 0.85, sharp: 2, warp: 1.2, pore: 0.1, fresh: 1.1, contrast: 0.14 },
  acrylic: null,
  aluminum: null,
};

// Matches material-appearance's DEFAULT_APPEARANCE, which keeps the generic
// timber palette for an unconfigured ("Custom") job.
const DEFAULT_GRAIN: GrainAppearance = {
  ringFreq: 0.4,
  sharp: 3.2,
  warp: 2.6,
  pore: 0.3,
  fresh: 1.2,
  contrast: 0.5,
};

/**
 * Looks up how a stock material's grain should be figured.
 *
 * @param key The job's ChiploadMaterial key, or undefined for "Custom".
 * @returns Grain parameters, or null when the stock is not timber.
 */
export function woodGrainFor(key: ChiploadMaterial | undefined): GrainAppearance | null {
  if (key === undefined) return DEFAULT_GRAIN;
  const family = CHIPLOAD_MATERIALS.find((material) => material.value === key)?.family;
  if (family === undefined) return DEFAULT_GRAIN;
  return GRAIN_BY_FAMILY[family] ?? null;
}
