import type { Job } from '../job';
import { cutTypeLabel } from '../scene';
import type { PreflightIssue } from './preflight';

/** Fresh and archived review use only the evidence retained with this exact Job. */
export function cncOpenContourIssues(job: Job | undefined): ReadonlyArray<PreflightIssue> {
  return (job?.cncCompilation?.omittedOpenContours ?? []).map(({ layerId, cutType, count }) => ({
    code: 'cnc-open-contours-omitted',
    message:
      `Layer ${layerId}: ${count} open contour${count === 1 ? ' is' : 's are'} omitted. ` +
      `${cutTypeLabel(cutType)} needs closed outlines. ` +
      'Use Engrave or On path for open strokes, or close the shapes.',
  }));
}
