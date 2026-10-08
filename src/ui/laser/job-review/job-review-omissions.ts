import type { OutputScope } from '../../../core/scene';
import {
  buildCncContourOmissions,
  type JobReviewCncContourOmissions,
} from './job-review-cnc-omissions';
import { buildFillOmissions, type JobReviewFillOmissions } from './job-review-fill-omissions';
import type { PreparedCurrentStart } from './job-review-model';

export type JobReviewOmissions = {
  readonly openFillOmissions?: JobReviewFillOmissions;
  readonly openCncContourOmissions?: JobReviewCncContourOmissions;
};

/** Keep source-owned advisory metadata out of the main review model's display mapping. */
export function buildReviewedOmissions(
  prepared: PreparedCurrentStart,
  scope: OutputScope,
): JobReviewOmissions {
  const openFillOmissions = buildFillOmissions(prepared, scope);
  const openCncContourOmissions = buildCncContourOmissions(prepared, scope);
  return {
    ...(openFillOmissions === undefined ? {} : { openFillOmissions }),
    ...(openCncContourOmissions === undefined ? {} : { openCncContourOmissions }),
  };
}
