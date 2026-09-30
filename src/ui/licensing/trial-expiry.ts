import type { LicenceStatus } from '../../platform/types';

/** Cached rights never extend a trial beyond its signed deadline. */
export function trialHasExpired(
  status: LicenceStatus | null,
  nowSeconds = Date.now() / 1000,
): boolean {
  return (
    status?.tier === 'trial' &&
    status.accessExpiresAt !== null &&
    nowSeconds >= status.accessExpiresAt
  );
}

export type TrialExpiryClock = ReturnType<typeof createTrialExpiryClock>;

/** Wall-clock rollback cannot extend a trial already observed by this window. */
export function createTrialExpiryClock() {
  let clock: {
    expiresAt: number;
    startedAt: number;
    startedElapsedMs: number;
    observedAt: number;
  } | null = null;
  const remainingMs = (status: LicenceStatus | null): number => {
    if (status?.tier !== 'trial' || status.accessExpiresAt === null) return Infinity;
    if (clock === null || clock.expiresAt !== status.accessExpiresAt)
      clock = {
        expiresAt: status.accessExpiresAt,
        startedAt: Date.now(),
        startedElapsedMs: performance.now(),
        observedAt: Date.now(),
      };
    clock.observedAt = Math.max(
      clock.observedAt,
      Date.now(),
      clock.startedAt + Math.max(0, performance.now() - clock.startedElapsedMs),
    );
    return clock.expiresAt * 1000 - clock.observedAt;
  };
  return { remainingMs };
}

export function expireTrialStatus(status: LicenceStatus, clock?: TrialExpiryClock): LicenceStatus {
  const expired = clock === undefined ? trialHasExpired(status) : clock.remainingMs(status) <= 0;
  if (!expired || status.edition === 'free') return status;
  return {
    ...status,
    edition: 'free',
    state: 'trial-expired',
    message:
      'Your 30-day Pro trial has ended. Existing work keeps working. Buy a licence or enter your key to choose new Pro tools.',
  };
}
