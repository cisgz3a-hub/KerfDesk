import type { LicenceStatus } from './licensing-status.js';
import type { LicenceRecord } from './licensing-store.js';
import { nextClockMark } from './licensing-clock.js';
import { MESSAGES } from './licensing-messages.js';

/** Saves every observed whole second; ordinary status checks fail if it cannot persist. */
export async function saveTrialClock(
  status: LicenceStatus,
  saved: LicenceRecord,
  now: number,
  write: (next: LicenceRecord) => Promise<void>,
  recoverActivation?: () => LicenceStatus,
): Promise<LicenceStatus> {
  const mark = nextClockMark(status, saved.lastSeenAt, Math.floor(now));
  if (mark !== null) {
    try {
      await write({ ...saved, lastSeenAt: mark });
    } catch (error) {
      if (recoverActivation === undefined || status.state === 'clock-error') throw error;
      // Only activation may retain its verified trial after a failed checkpoint.
      // Re-evaluate the signed deadline without resetting the process-local clock.
      return { ...recoverActivation(), message: status.message ?? MESSAGES.unavailable };
    }
  }
  return status;
}

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
