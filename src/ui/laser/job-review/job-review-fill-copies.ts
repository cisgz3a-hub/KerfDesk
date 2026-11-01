import { cancelledFillCopies } from '../../../core/job/cancelled-fill-copies';
import {
  filterSceneForOutputScope,
  machineKindOf,
  type OutputScope,
  type Scene,
} from '../../../core/scene';
import type { PreparedCurrentStart } from './job-review-model';
import { reviewArtworkSources, type ReviewArtworkSource } from './review-artwork-sources';

/** The extra copies of stacked Fill shapes that cancel (ADR-683), for "Show stacked copies". */
export type JobReviewStackedFillCopies = {
  readonly sources: ReadonlyArray<ReviewArtworkSource>;
};

export function buildStackedFillCopies(
  prepared: PreparedCurrentStart,
  outputScope: OutputScope,
): JobReviewStackedFillCopies | undefined {
  // An archive or painted pass cannot establish correspondence to the canvas.
  if ('laserResumeChain' in prepared || prepared.laserSecondPassChain !== undefined)
    return undefined;
  const project = prepared.prepared.project;
  if (machineKindOf(project.machine) !== 'laser') return undefined;
  const scene = filterSceneForOutputScope(project.scene, outputScope);
  const extras = extraFillCopyIds(scene);
  if (extras.size === 0) return undefined;
  return { sources: reviewArtworkSources(scene.objects.filter((object) => extras.has(object.id))) };
}

/** Every copy but the lowest in each cancelling set: deleting them leaves one that burns. */
export function extraFillCopyIds(scene: Scene): ReadonlySet<string> {
  return new Set(cancelledFillCopies(scene).flatMap((set) => set.objectIds.slice(1)));
}
