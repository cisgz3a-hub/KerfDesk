import {
  openFillContours,
  summarizeOpenFillContours,
  type OpenFillContourSummary,
} from '../../../core/job/open-fill-contours';
import { filterSceneForOutputScope, machineKindOf, type OutputScope } from '../../../core/scene';
import type { PreparedCurrentStart } from './job-review-model';
import { reviewArtworkSources, type ReviewArtworkSource } from './review-artwork-sources';

export type JobReviewFillOmissions = OpenFillContourSummary & {
  readonly sources: ReadonlyArray<ReviewArtworkSource>;
};

export function buildFillOmissions(
  prepared: PreparedCurrentStart,
  outputScope: OutputScope,
): JobReviewFillOmissions | undefined {
  // An archive or painted pass cannot establish correspondence to the canvas.
  if ('laserResumeChain' in prepared || prepared.laserSecondPassChain !== undefined)
    return undefined;
  const project = prepared.prepared.project;
  if (machineKindOf(project.machine) !== 'laser') return undefined;
  const groups = openFillContours(filterSceneForOutputScope(project.scene, outputScope));
  const summary = summarizeOpenFillContours(groups);
  if (summary.contourCount === 0) return undefined;
  const objects = [...new Map(groups.map((group) => [group.object.id, group.object])).values()];
  return { ...summary, sources: reviewArtworkSources(objects) };
}
