/**
 * Kerf presets for the Box Generator. Each preset names a typical
 * laser+material combination and the kerf width users can expect for
 * a starting value. Kerf depends on machine, focus, speed, and
 * material batch — these are starting points, not absolutes.
 *
 * Sources:
 *   - 0.16mm CO2 on plywood/MDF: widely cited hobby-CO2 value
 *     (Hackaday, LightBurn community).
 *   - 0.10mm diode on plywood/MDF: typical of 5-20W hobby diode
 *     lasers per industry kerf tables (CutLaserCut and similar).
 *   - 0.20mm CO2 on acrylic: melts more than wood; slightly wider
 *     kerf (CutLaserCut benchmark, LightBurn community reports).
 *   - 0.25mm CO2 on cardboard: softer material burns wider
 *     (CutLaserCut industry table).
 *
 * Users should test-cut and adjust. The preset is a starting point
 * to save users the "I have no idea what kerf to enter" moment.
 */

export interface KerfPreset {
  /** Stable identifier; use 'custom' to mean "don't apply a preset". */
  id: string;
  /** Human-readable label shown in the dropdown. */
  label: string;
  /** Kerf in mm. Ignored when id === 'custom'. */
  kerf: number;
}

export const KERF_PRESETS: KerfPreset[] = [
  { id: 'custom', label: 'Custom', kerf: 0 },
  { id: 'diode-wood', label: 'Diode laser, plywood/MDF', kerf: 0.1 },
  { id: 'co2-wood', label: 'CO2 laser, plywood/MDF', kerf: 0.16 },
  { id: 'co2-acrylic', label: 'CO2 laser, acrylic', kerf: 0.2 },
  { id: 'co2-cardboard', label: 'CO2 laser, cardboard', kerf: 0.25 },
];

/**
 * Match a kerf value to a preset id. Returns 'custom' if no preset
 * has this exact kerf — "exact" with a small tolerance because the
 * UI step is 0.05mm and floating-point comparisons can drift.
 *
 * The 'custom' preset (kerf 0) only matches when the kerf is exactly
 * 0; non-zero values that don't match any other preset still fall
 * back to 'custom'.
 */
export function findPresetIdForKerf(kerf: number): string {
  const eps = 1e-6;
  for (const p of KERF_PRESETS) {
    if (p.id === 'custom') continue;
    if (Math.abs(p.kerf - kerf) < eps) return p.id;
  }
  return 'custom';
}
