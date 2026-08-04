import type { Polyline } from '../scene';
import type { VCarveLadder, VCarveOptions } from './vcarve-ladder';
import {
  finalizeVCarveMedialWork,
  prepareVCarveMedialWork,
  runVCarveMedialRegionTask,
} from './vcarve-medial-work';

/**
 * Plan one certified variable-depth route set per normalized filled region.
 * Delaunay supplies topology candidates only: exact containment checks decide
 * every accepted XY chord, and emitted-grid depth certification protects the
 * final 0.001 mm XYZ commands against the original normalized boundary.
 */
export function vcarveMedialPasses(
  polylines: ReadonlyArray<Polyline>,
  options: VCarveOptions,
): VCarveLadder {
  const work = prepareVCarveMedialWork(polylines, options);
  if (work.kind === 'complete') return work.result;
  return finalizeVCarveMedialWork(work, work.tasks.map(runVCarveMedialRegionTask));
}
