import { useEffect } from 'react';
import type { LicenceStatus } from '../../platform/types';
import { expireTrialStatus, type TrialExpiryClock } from './trial-expiry';

/** Refresh the edition at expiry without closing an open tool or workspace. */
export function useTrialExpiry(
  status: LicenceStatus | null,
  accept: (status: LicenceStatus, expected: LicenceStatus) => Promise<void>,
  clock: TrialExpiryClock,
): void {
  useEffect(() => {
    if (status?.tier !== 'trial' || status.edition !== 'pro' || status.accessExpiresAt === null)
      return;
    let timer: number | undefined;
    const check = (): void => {
      window.clearTimeout(timer);
      const next = expireTrialStatus(status, clock);
      if (next !== status) {
        void accept(next, status);
        return;
      }
      // Thirty days exceeds the browser timer limit. Recheck at most daily and
      // after sleep/focus; the synchronous choice gate also checks the deadline.
      timer = window.setTimeout(
        check,
        Math.max(1, Math.min(86_400_000, clock.remainingMs(status))),
      );
    };
    check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [accept, clock, status]);
}
