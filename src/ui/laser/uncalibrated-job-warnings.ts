import type { Job } from '../../core/job';
import { LAYER_DEFAULTS, type Layer } from '../../core/scene';

// One grouped message instead of one per layer: a ten-layer import used to
// produce ten near-identical warnings that drowned the rest of the review.
const MAX_NAMED_OPERATIONS = 4;

/** Reports emitted laser groups that still use the first-run recipe — one
 * grouped warning naming the affected operations (never their raw ids). */
export function detectUncalibratedJobWarnings(
  job: Job,
  layers: ReadonlyArray<Layer>,
): ReadonlyArray<string> {
  const layerIds = new Set<string>();
  for (const group of job.groups) {
    if (group.kind === 'cnc' || !usesUncalibratedDefaults(group)) continue;
    layerIds.add(group.layerId);
  }
  if (layerIds.size === 0) return [];
  return [describeUncalibratedOperations([...layerIds], layers)];
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

/** The grouped operator-facing message for the given still-default layers. */
export function describeUncalibratedOperations(
  layerIds: ReadonlyArray<string>,
  layers: ReadonlyArray<Layer>,
): string {
  const names = layerIds.map((id) => layers.find((layer) => layer.id === id)?.name ?? id);
  const recipe = `${LAYER_DEFAULTS.power}% power, ${LAYER_DEFAULTS.speed} mm/min, ${LAYER_DEFAULTS.passes} pass`;
  const advice = 'Run a material test on scrap before burning final material.';
  const [first] = names;
  if (names.length === 1 && first !== undefined) {
    return `Operation "${first}" is still using the uncalibrated defaults (${recipe}). ${advice}`;
  }
  return `${names.length} operations are still using the uncalibrated defaults (${recipe}): ${nameList(names)}. ${advice}`;
}

function nameList(names: ReadonlyArray<string>): string {
  const quoted = names.slice(0, MAX_NAMED_OPERATIONS).map((name) => `"${name}"`);
  const extra = names.length - quoted.length;
  return extra > 0 ? `${quoted.join(', ')}, and ${extra} more` : quoted.join(', ');
}
