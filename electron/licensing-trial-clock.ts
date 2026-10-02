import type { LicenceStatus } from './licensing-status.js';

/** Sends the renderer the remaining observed time without changing the signed deadline. */
export function withTrialBudget(
  status: LicenceStatus,
  lastSeenAt: number,
  now: () => number,
): LicenceStatus {
  if (status.tier !== 'trial' || status.accessExpiresAt === null) return status;
  return {
    ...status,
    trialExpiresInMs: Math.max(
      0,
      Math.floor((status.accessExpiresAt - Math.max(lastSeenAt, now())) * 1000),
    ),
  };
}

/** A trial's process-local time cannot move backwards or outlive elapsed time. */
export class TrialSessionClock {
  private readonly startedAt: number;
  private readonly startedElapsedMs = performance.now();
  private observedAt: number;

  constructor(
    readonly expiresAt: number,
    private readonly wallNow: () => number,
    lastSeenAt = 0,
  ) {
    this.startedAt = Math.max(wallNow(), lastSeenAt);
    this.observedAt = this.startedAt;
  }

  readonly now = (): number => {
    this.observedAt = Math.max(
      this.observedAt,
      this.wallNow(),
      this.startedAt + Math.max(0, performance.now() - this.startedElapsedMs) / 1000,
    );
    return this.observedAt;
  };
}
