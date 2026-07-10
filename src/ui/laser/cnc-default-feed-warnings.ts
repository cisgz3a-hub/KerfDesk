// detectCncDefaultFeedWarnings — CNC-mode advisory: an output layer that still
// carries the generic starter feed/plunge (the untouched DEFAULT_CNC_LAYER_SETTINGS
// values) and has no material picked hasn't been tuned for the operator's stock
// and bit — the exact "cut-wrecking defaults" ADR-111 was written about.
//
// The only other guard, detectCncMachineLimitWarnings, is connection-dependent
// (it returns [] when the controller's limits are unknown), so an OFFLINE
// beginner gets zero guidance. This one fires without a connection. Advisory,
// not a gate — the defaults are legitimate once the operator confirms them.

import { DEFAULT_CNC_LAYER_SETTINGS, type Project } from '../../core/scene';

export function detectCncDefaultFeedWarnings(project: Project): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') return [];

  const warnings: string[] = [];
  for (const layer of project.scene.layers) {
    if (!layer.output) continue;
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    // Compared against the constants (not magic numbers) so they stay in sync if
    // the defaults change. Silent once a material is picked or the feeds are
    // edited off the starter values.
    const untuned =
      settings.materialKey === undefined &&
      settings.feedMmPerMin === DEFAULT_CNC_LAYER_SETTINGS.feedMmPerMin &&
      settings.depthPerPassMm === DEFAULT_CNC_LAYER_SETTINGS.depthPerPassMm;
    if (untuned) {
      warnings.push(
        `Layer ${layer.id} uses the generic starter feeds ` +
          `(${DEFAULT_CNC_LAYER_SETTINGS.feedMmPerMin} mm/min, ${DEFAULT_CNC_LAYER_SETTINGS.depthPerPassMm} mm/pass). ` +
          'Pick a material in Material & Bit to tune them for your stock and bit.',
      );
    }
  }
  return warnings;
}
