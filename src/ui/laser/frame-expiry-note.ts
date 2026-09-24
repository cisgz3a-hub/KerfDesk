// Why the last completed Frame expired (controller audit gap-start-2). The
// invalidation subscription consumes a permit silently the moment the job or
// the controller drifts, so a later Start found no permit, ran a fresh Frame
// trace and never said why: after a layer speed edit the head traced the
// outline again with no job bytes, and the operator had to press Start a
// third time without knowing what had happened. Start now says so when it
// re-frames because of an expiry.

let lastExpiryReason: string | null = null;

export function noteFrameExpired(reason: string): void {
  lastExpiryReason = reason;
}

/** The reason recorded since the last call, consumed so it is said once. */
export function takeFrameExpiryReason(): string | null {
  const reason = lastExpiryReason;
  lastExpiryReason = null;
  return reason;
}

export function frameExpiryRestartMessage(reason: string): string {
  return `${reason} Start is framing the job again first; press Start once the Frame completes.`;
}
