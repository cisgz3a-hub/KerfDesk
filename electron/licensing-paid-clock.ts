import { nextPaidMark } from './licensing-clock.js';
import type { LicenceStatus } from './licensing-status.js';
import type { LicenceRecord } from './licensing-store.js';
import { TrialSessionClock } from './licensing-trial-clock.js';

type Loaded = { readonly saved: LicenceRecord; readonly device: string };

/**
 * A paid licence's last-seen mark (ADR-592). It moves on from the later of this
 * computer's clock and the time this session has run since the saved mark, so
 * winding the clock back, between or during sessions, cannot hold off the paid
 * check-in or the refresh that fetches a refund. Saving is best effort: paid
 * rights never end by the clock, so a failed save changes no status and the
 * mark is tried again at the next check.
 */
export class PaidClockMark {
  private clock: TrialSessionClock | null = null;
  // The grant the session clock was started for; a new grant restarts it.
  private payload: string | null = null;

  constructor(private readonly wallNow: () => number) {}

  async save(
    status: LicenceStatus,
    load: () => Promise<Loaded>,
    write: (next: LicenceRecord, device: string) => Promise<void>,
    cache: { readonly update: (saved: LicenceRecord, device: string) => void },
  ): Promise<void> {
    if (status.tier !== 'paid') return;
    let loaded: Loaded;
    try {
      loaded = await load();
    } catch {
      return;
    }
    const { saved, device } = loaded;
    const payload = saved.credential?.entitlement.payload ?? null;
    if (this.clock === null || payload !== this.payload) {
      this.clock = new TrialSessionClock(Infinity, this.wallNow, saved.lastSeenAt);
      this.payload = payload;
    }
    const mark = nextPaidMark(status, saved.lastSeenAt, Math.floor(this.clock.now()));
    if (mark === null) return;
    // The store writes atomically, so a failure leaves the saved record as it was.
    await write({ ...saved, lastSeenAt: mark }, device).catch(() => cache.update(saved, device));
  }
}
