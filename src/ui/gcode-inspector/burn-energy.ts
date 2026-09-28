// How dark a laser pass burns, from the energy it puts into each square
// millimetre (ADR-501, amending ADR-487's power-only shading).
//
// A pass at `power` (share of full power) and `feedMmPerMin`, with a beam
// `beamMm` wide, puts opticalPowerW × power ÷ (speed × beam width) joules into
// each square millimetre it covers. Each material has a dose that leaves 8% of
// its light (it chars, frosts or marks fully). A pass at a share of that dose
// darkens as the power-only shading does at that share of full power, and
// passes and overlapping lines add their optical densities.
//
// Uncalibrated: the doses are round figures from typical diode results, not
// measurements, and a laser without a stated optical power is taken as 10 W.
// It shows which parts burn darker than others, not the exact colour.

import type { StockMaterial } from '../viewer3d/scene-stock-materials';

/** Joules per mm² that leave 8% of the material's light. Uncalibrated. */
export const FULL_BURN_DOSE_J_PER_MM2: Readonly<Record<StockMaterial, number>> = {
  wood: 2,
  mdf: 1.5,
  acrylic: 4,
  aluminium: 1.2,
  laminate: 1.5,
  // Flat grey and the burn map show the burn itself; they burn as wood.
  grey: 2,
  height: 2,
};

/** Optical power taken for a laser whose head does not state one. */
export const ASSUMED_OPTICAL_POWER_W = 10;

// A pass at full power, or at the full dose, leaves this share of the light.
const FULL_BURN_LIGHT = 0.08;
// Past the full dose the surface keeps darkening, down to this much light.
const DARKEST_LIGHT = 0.02;

export type BurnHead = {
  readonly opticalPowerW: number;
  readonly beamMm: number;
};

export type BurnPass = {
  /** Share of full power, 0 to 1 (S over the controller's `$30`). */
  readonly power: number;
  readonly feedMmPerMin: number;
};

/** Joules per mm² one pass puts into the strip its beam covers. */
export function passDoseJPerMm2(head: BurnHead, pass: BurnPass): number {
  const power = clamp01(pass.power);
  const mmPerSec = pass.feedMmPerMin / 60;
  if (power <= 0 || !(mmPerSec > 0) || !(head.beamMm > 0) || !(head.opticalPowerW > 0)) return 0;
  return (head.opticalPowerW * power) / (mmPerSec * head.beamMm);
}

/** The optical density one pass leaves by its power alone, as LightBurn shades. */
export function powerDensity(power: number): number {
  return -Math.log(1 - (1 - FULL_BURN_LIGHT) * clamp01(power));
}

/** The optical density one pass leaves by its dose against the material's full dose. */
export function doseDensity(doseJPerMm2: number, fullDoseJPerMm2: number): number {
  const share = fullDoseJPerMm2 > 0 ? Math.max(0, doseJPerMm2) / fullDoseJPerMm2 : 0;
  return -Math.log(Math.max(DARKEST_LIGHT, 1 - (1 - FULL_BURN_LIGHT) * share));
}

/** The share of the surface's light left under a total optical density. */
export function lightAfter(density: number): number {
  return Math.exp(-Math.max(0, density));
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
