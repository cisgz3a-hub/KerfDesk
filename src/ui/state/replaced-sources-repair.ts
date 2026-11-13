// Weld, Subtract / Intersect / Exclude, Union Silhouette and Join Paths remove
// their sources and add a new object in their place (ADR-350 Amendment 2). An
// image masked by a source, or text set on a source as its path, would then
// point at an id that no longer exists: the job burns the whole photo unmasked
// with no warning (T29-P1-2, T29R-P2-1). They repair those references as
// Delete does, and say so once the edit commits.

import type { Scene } from '../../core/scene';
import { reportDependencyRepairs } from './object-delete-actions';
import { repairRemovedObjectReferences } from './repair-object-dependencies';

export type ReplacedSourcesRepair = {
  readonly scene: Scene;
  /** Shows the dependency notice; call it after the edit commits. */
  readonly report: () => void;
};

/** `scene` with masks and text guides that pointed at removed sources cleared. */
export function repairReplacedSources(scene: Scene): ReplacedSourcesRepair {
  const repaired = repairRemovedObjectReferences(scene);
  return {
    scene: repaired.scene,
    report: () => reportDependencyRepairs(repaired, 'replaced'),
  };
}
