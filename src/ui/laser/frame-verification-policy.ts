import type { ResolvedJobPlacement } from '../job-placement';

export type FrameVerificationRequirement = 'none' | 'verified-origin';

export function frameVerificationRequirement(
  placement: Extract<ResolvedJobPlacement, { readonly ok: true }>,
): FrameVerificationRequirement {
  const mode = placement.jobOrigin?.startFrom;
  if (mode === 'verified-origin') return 'verified-origin';
  return 'none';
}

export function frameVerificationBlockedMessage(): string {
  return (
    'Verified Origin needs a Verified Frame first: click Frame to trace the job and confirm ' +
    'it fits, then Start. Re-frame after moving the origin or changing the job.'
  );
}
