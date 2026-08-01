import type { JobBounds } from '../../core/job';
import type { StartJobPreparation } from './start-job-readiness';

type PreparedFrameCandidate = Extract<StartJobPreparation, { readonly ok: true }>;

export type ResolvedFrameCandidate =
  | {
      readonly ok: true;
      readonly jobBounds: JobBounds;
      readonly motionBounds: JobBounds;
    }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

/** Resolve the exact rectangle to trace. Calculated bed and no-go findings are
 * Job Review warnings; only the physical Frame outcome authorizes Start. */
export function resolveFrameCandidate(preparation: PreparedFrameCandidate): ResolvedFrameCandidate {
  const jobBounds = preparation.metrics.frameJobBounds;
  if (jobBounds === null) {
    return { ok: false, messages: ['Nothing to frame — enable Output on at least one layer.'] };
  }
  const motionBounds = preparation.metrics.frameMotionBounds ?? jobBounds;
  return { ok: true, jobBounds, motionBounds };
}
