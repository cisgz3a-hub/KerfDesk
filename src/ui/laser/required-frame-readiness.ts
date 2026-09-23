import { frameBoundsSignature, machineSpaceJob } from '../../core/job';
import {
  computeFrameJobBounds,
  computeFrameJobMotionBounds,
  type JobBounds,
} from '../../core/job/job-bounds';
import type { PreparedOutput } from '../../io/gcode';
import { isVerifiedFrameValid, type FrameVerification } from '../state/frame-verification';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import { frameVerificationBlockedMessage } from './frame-verification-policy';

export type RequiredFrameSnapshot = {
  readonly frameVerification?: FrameVerification | null;
  readonly wcoCache?: WorkCoordinateOffset | null;
  readonly workOriginActive?: boolean;
};

/** Frame-first gate: every Start (laser and CNC, every placement mode) needs
 * a Frame recorded for this exact compiled job and origin identity. Any drift
 * — resized artwork, moved origin, different head position baked into a
 * current-position compile — changes the bounds signature or WCO and forces a
 * fresh trace. This is the ONLY Start guard; all other findings surface as
 * Job Review warnings (maintainer, 2026-07-17). */
export function requiredFrameIssueFromPrepared(args: {
  readonly prepared: Extract<PreparedOutput, { readonly ok: true }>;
  readonly machine: RequiredFrameSnapshot;
}): string | null {
  const bounds = preparedFrameBounds(args.prepared);
  if (bounds === null) return null;
  const valid = isVerifiedFrameValid(args.machine.frameVerification ?? null, {
    boundsSignature: frameBoundsSignature(bounds),
    wco: args.machine.wcoCache ?? null,
    workOriginActive: args.machine.workOriginActive === true,
  });
  return valid ? null : frameVerificationBlockedMessage();
}

type PreparedOk = Extract<PreparedOutput, { readonly ok: true }>;

// Job Review checks the same immutable compile when it opens and again at
// Confirm, and walking a dense fill for its envelope cost ~0.2 s each time,
// between the Confirm click and the first byte (ADR-349).
const frameBoundsByPrepared = new WeakMap<PreparedOk, JobBounds | null>();

function preparedFrameBounds(prepared: PreparedOk): JobBounds | null {
  if (frameBoundsByPrepared.has(prepared)) return frameBoundsByPrepared.get(prepared) ?? null;
  const framedJob = machineSpaceJob(
    prepared.job,
    prepared.project.device,
    prepared.project.machine,
  );
  const burnBounds = computeFrameJobBounds(framedJob, prepared.project.device);
  const bounds =
    prepared.project.machine?.kind === 'cnc'
      ? burnBounds
      : (computeFrameJobMotionBounds(framedJob, prepared.project.device) ?? burnBounds);
  frameBoundsByPrepared.set(prepared, bounds);
  return bounds;
}
