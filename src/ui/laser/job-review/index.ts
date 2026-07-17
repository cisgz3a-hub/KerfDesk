// Job Review (ADR-224) — public surface. The dialog mounts once at App
// level; the gate is awaited by the shared start flow; the store and test
// seam exist for flow tests that drive Start end-to-end.

export { JobReviewDialog } from './JobReviewDialog';
export {
  runJobReviewGate,
  type ConfirmedJobReview,
  type ReviewedStartBundle,
} from './job-review-gate';
export { buildJobReviewModel, type JobReviewModel } from './job-review-model';
export { useJobReviewStore } from './job-review-store';
export { captureJobReviewModels, installAutoJobReview } from './testing';
