import { filterSceneForOutputScope, machineKindOf, type OutputScope } from '../../../core/scene';
import type { PreparedCurrentStart } from './job-review-model';
import { reviewArtworkSources, type ReviewArtworkSource } from './review-artwork-sources';

export type JobReviewCncContourOmissions = {
  readonly objectIds: ReadonlyArray<string>;
  readonly contourCount: number;
  readonly sources: ReadonlyArray<ReviewArtworkSource>;
};

export function buildCncContourOmissions(
  prepared: PreparedCurrentStart,
  outputScope: OutputScope,
): JobReviewCncContourOmissions | undefined {
  // Stored programs cannot establish correspondence to today's editable canvas.
  if ('laserResumeChain' in prepared || prepared.laserSecondPassChain !== undefined)
    return undefined;
  const project = prepared.prepared.project;
  if (machineKindOf(project.machine) !== 'cnc') return undefined;
  const evidence = prepared.prepared.job.cncCompilation;
  const contourCount = (evidence?.omittedOpenContours ?? []).reduce(
    (count, entry) => count + entry.count,
    0,
  );
  const ids = new Set(evidence?.omittedOpenContourSources?.map((entry) => entry.objectId));
  const objects = filterSceneForOutputScope(project.scene, outputScope).objects.filter((object) =>
    ids.has(object.id),
  );
  if (contourCount === 0 || objects.length === 0) return undefined;
  return {
    objectIds: objects.map((object) => object.id),
    contourCount,
    sources: reviewArtworkSources(objects),
  };
}
