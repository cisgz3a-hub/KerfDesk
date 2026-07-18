import { computeJobBounds, frameBoundsSignature, machineSpaceJob } from '../../core/job';
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
  const prepared = args.prepared;
  const framedJob = machineSpaceJob(
    prepared.job,
    prepared.project.device,
    prepared.project.machine,
  );
  const bounds = computeJobBounds(framedJob, prepared.project.device);
  if (bounds === null) return null;
  const valid = isVerifiedFrameValid(args.machine.frameVerification ?? null, {
    boundsSignature: frameBoundsSignature(bounds),
    wco: args.machine.wcoCache ?? null,
    workOriginActive: args.machine.workOriginActive === true,
  });
  return valid ? null : frameVerificationBlockedMessage();
}
