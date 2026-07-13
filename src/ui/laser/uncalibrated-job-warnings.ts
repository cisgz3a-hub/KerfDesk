import type { Job } from '../../core/job';
import { LAYER_DEFAULTS } from '../../core/scene';

/** Reports emitted laser groups that still use the first-run recipe. */
export function detectUncalibratedJobWarnings(job: Job): ReadonlyArray<string> {
  const layerIds = new Set<string>();
  for (const group of job.groups) {
    if (group.kind === 'cnc' || !usesUncalibratedDefaults(group)) continue;
    layerIds.add(group.layerId);
  }
  return [...layerIds].map(uncalibratedLayerWarning);
}

function usesUncalibratedDefaults(
  group: Exclude<Job['groups'][number], { readonly kind: 'cnc' }>,
): boolean {
  return (
    group.power === LAYER_DEFAULTS.power &&
    group.speed === LAYER_DEFAULTS.speed &&
    group.passes === LAYER_DEFAULTS.passes
  );
}

function uncalibratedLayerWarning(layerId: string): string {
  return `Layer ${layerId} is still using uncalibrated defaults: ${LAYER_DEFAULTS.power}% power, ${LAYER_DEFAULTS.speed} mm/min, ${LAYER_DEFAULTS.passes} pass. Run a material test on scrap before burning final material.`;
}
