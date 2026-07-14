import type { DeviceProfile } from '../../core/devices';
import { computeJobBounds, frameBoundsSignature } from '../../core/job';
import type { PreparedOutput } from '../../io/gcode';
import type { ResolvedJobPlacement } from '../job-placement';
import { isVerifiedFrameValid, type FrameVerification } from '../state/frame-verification';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import {
  frameVerificationBlockedMessage,
  frameVerificationRequirement,
} from './frame-verification-policy';

export type RequiredFrameSnapshot = {
  readonly frameVerification?: FrameVerification | null;
  readonly wcoCache?: WorkCoordinateOffset | null;
  readonly workOriginActive?: boolean;
};

export function requiredFrameIssueFromPrepared(args: {
  readonly device: Pick<DeviceProfile, 'homing'>;
  readonly prepared: Extract<PreparedOutput, { readonly ok: true }>;
  readonly placement: Extract<ResolvedJobPlacement, { readonly ok: true }>;
  readonly machine: RequiredFrameSnapshot;
}): string | null {
  const requirement = frameVerificationRequirement(args.device, args.placement);
  if (requirement === 'none') return null;
  const bounds = computeJobBounds(args.prepared.job, args.prepared.project.device);
  if (bounds === null) return null;
  const valid = isVerifiedFrameValid(args.machine.frameVerification ?? null, {
    boundsSignature: frameBoundsSignature(bounds),
    wco: args.machine.wcoCache ?? null,
    workOriginActive: args.machine.workOriginActive === true,
  });
  return valid ? null : frameVerificationBlockedMessage(requirement);
}
