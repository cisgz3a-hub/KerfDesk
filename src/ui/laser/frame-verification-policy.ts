import type { DeviceProfile } from '../../core/devices';
import type { ResolvedJobPlacement } from '../job-placement';

export type FrameVerificationRequirement = 'none' | 'verified-origin' | 'no-homing-relative';

export function frameVerificationRequirement(
  device: Pick<DeviceProfile, 'homing'>,
  placement: Extract<ResolvedJobPlacement, { readonly ok: true }>,
): FrameVerificationRequirement {
  const mode = placement.jobOrigin?.startFrom;
  if (mode === 'verified-origin') return 'verified-origin';
  if (!device.homing.enabled && (mode === 'current-position' || mode === 'user-origin')) {
    return 'no-homing-relative';
  }
  return 'none';
}

export function frameVerificationBlockedMessage(
  requirement: Exclude<FrameVerificationRequirement, 'none'>,
): string {
  if (requirement === 'verified-origin') {
    return (
      'Verified Origin needs a Verified Frame first: click Frame to trace the job and confirm ' +
      'it fits, then Start. Re-frame after moving the origin or changing the job.'
    );
  }
  return (
    'This no-homing placement needs a Frame first: click Frame to trace the job and confirm ' +
    'it fits, then Start. Re-frame after jogging the head or changing the job.'
  );
}
