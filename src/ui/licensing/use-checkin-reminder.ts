import { useEffect, useRef } from 'react';
import type { LicenceStatus } from '../../platform/types';
import { useToastStore } from '../state/toast-store';

const DAY = 86_400;
/** How long before a paid check-in falls due KerfDesk mentions it (ADR-592). */
export const CHECK_IN_REMINDER_DAYS = 5;

/**
 * The reminder for a paid licence whose check-in falls due within a few days,
 * or null. A device that is online refreshes weekly, so only one that has been
 * offline for about three weeks ever sees it.
 */
export function checkInReminder(status: LicenceStatus | null, nowSeconds: number): string | null {
  if (status?.tier !== 'paid' || status.edition !== 'pro' || status.checkInDueAt === undefined)
    return null;
  if (status.state !== 'ready' && status.state !== 'updates-expired') return null;
  const left = status.checkInDueAt - nowSeconds;
  if (left <= 0 || left > CHECK_IN_REMINDER_DAYS * DAY) return null;
  const days = Math.ceil(left / DAY);
  return `KerfDesk has not reached the licence service for a while. Connect to the internet within ${days === 1 ? '1 day' : `${days} days`} so new Pro tools stay available; your projects, Frame and Start never wait for it.`;
}

/** Shows the check-in reminder at most once per launch. */
export function useCheckInReminder(status: LicenceStatus | null): void {
  const shown = useRef(false);
  const pushToast = useToastStore((state) => state.pushToast);
  useEffect(() => {
    if (shown.current) return;
    const reminder = checkInReminder(status, Math.floor(Date.now() / 1000));
    if (reminder === null) return;
    shown.current = true;
    pushToast(reminder, 'info');
  }, [pushToast, status]);
}
