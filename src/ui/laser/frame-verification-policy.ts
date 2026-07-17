// Frame-first Start policy (maintainer, 2026-07-17): a completed Frame for
// the exact current job is THE Start gate, for every placement mode on both
// laser and CNC. The operator watches the beam-off trace; everything the old
// policy guards refused for is a Job Review warning instead.

export function frameVerificationBlockedMessage(): string {
  return (
    'Start needs a completed Frame for this exact job first: click Frame to trace the ' +
    'outline and watch that it lands where you expect, then Start. Re-frame after moving ' +
    'the origin or head, or changing the job.'
  );
}
