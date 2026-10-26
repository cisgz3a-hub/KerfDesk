import type { Job } from '../job';
import { cutTypeLabel } from '../scene';
import type { PreflightIssue } from './preflight';

/** Fresh and archived review read the merges retained with this exact Job. */
export function cncStackedCopyIssues(job: Job | undefined): ReadonlyArray<PreflightIssue> {
  return (job?.cncCompilation?.mergedStackedCopies ?? []).map(({ layerId, cutType, count }) => ({
    code: 'cnc-stacked-copies-merged',
    message:
      `Layer ${layerId}: ${count} exact stacked ${count === 1 ? 'copy' : 'copies'} of a ` +
      `closed outline ${count === 1 ? 'is' : 'are'} cut once with the original. ` +
      `${cutTypeLabel(cutType)} fills closed outlines, and two identical outlines enclose ` +
      'nothing, so the shape would not be cut at all. Delete the extra copies to clear this note.',
  }));
}
