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

/** Cached reads or clock correction cannot extend an observed trial deadline. */
export function createTrialExpiryClock() {
  let clock: {
    expiresAt: number;
    startedAt: number;
    startedElapsedMs: number;
    observedElapsedMs: number;
    nativeDeadlineElapsedMs: number;
    observedAt: number;
  } | null = null;
  const remainingMs = (status: LicenceStatus | null): number => {
    if (status?.tier !== 'trial' || status.accessExpiresAt === null) return Infinity;
    if (clock === null || clock.expiresAt !== status.accessExpiresAt)
      clock = {
        expiresAt: status.accessExpiresAt,
        startedAt: Date.now(),
        startedElapsedMs: performance.now(),
        observedElapsedMs: 0,
        nativeDeadlineElapsedMs: Infinity,
        observedAt: Date.now(),
      };
    clock.observedElapsedMs = Math.max(
      clock.observedElapsedMs,
      Math.max(0, performance.now() - clock.startedElapsedMs),
    );
    if (status.trialExpiresInMs !== undefined) {
      const nativeRemainingMs = Number.isFinite(status.trialExpiresInMs)
        ? Math.max(0, status.trialExpiresInMs)
        : 0;
      // A later read may shorten the bound, but cached rights cannot renew it.
      clock.nativeDeadlineElapsedMs = Math.min(
        clock.nativeDeadlineElapsedMs,
        clock.observedElapsedMs + nativeRemainingMs,
      );
    }
    clock.observedAt = Math.max(
      clock.observedAt,
      Date.now(),
      clock.startedAt + clock.observedElapsedMs,
    );
    return Math.min(
      clock.expiresAt * 1000 - clock.observedAt,
      clock.nativeDeadlineElapsedMs - clock.observedElapsedMs,
    );
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
