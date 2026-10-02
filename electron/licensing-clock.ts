import type { LicenceClaims } from './licensing-verification.js';

// Clock rules for licences (ADR-523, ADR-523 Amendment 2). Only a trial ends by
// the clock, so only a trial is checked against it: a paid or developer licence
// never expires, and its eligible versions work offline whatever the clock says.

/** How far this computer's clock may differ from the licence service's, in seconds. */
export const CLOCK_TOLERANCE = 300;

/** True for rights that end at a set time, which only a trial has. */
export function clockLimited(claims: Pick<LicenceClaims, 'accessExpiresAt'>): boolean {
  return claims.accessExpiresAt !== null;
}

/** A trial whose clock is now earlier than its last check or its grant. */
export function clockRolledBack(claims: LicenceClaims, lastSeenAt: number, now: number): boolean {
  return clockLimited(claims) && now + CLOCK_TOLERANCE < Math.max(lastSeenAt, claims.issuedAt);
}

/**
 * The trial's new clock mark, or null when nothing needs saving. The mark keeps
 * a trial from coming back by winding the clock back between launches.
 */
export function nextClockMark(
  rights: Pick<LicenceClaims, 'accessExpiresAt'>,
  lastSeenAt: number,
  now: number,
): number | null {
  return clockLimited(rights) && now > lastSeenAt ? now : null;
}

/** A freshly issued grant whose time is too far from this computer's clock. */
export class LicenceClockError extends Error {
  /** Seconds this computer's clock is ahead of the licence service (behind if negative). */
  readonly offset: number;

  constructor(offset: number) {
    super('This computer’s clock does not match the licence service.');
    this.offset = offset;
  }
}

/** Refuses a grant issued too far from this computer's clock, whatever the tier. */
export function checkGrantTime(issuedAt: number, now: number): void {
  if (Math.abs(now - issuedAt) > CLOCK_TOLERANCE) throw new LicenceClockError(now - issuedAt);
}

export function clockErrorMessage(offset: number): string {
  return `This computer’s clock is ${roughly(Math.abs(offset))} ${offset > 0 ? 'ahead' : 'behind'}, so the licence could not be confirmed. Turn on Set time automatically in Windows’ Date & time settings, check the time zone, then try again.`;
}

// Called only for more than five minutes, so every unit rounds to two or more.
function roughly(seconds: number): string {
  if (seconds < 90 * 60) return `about ${Math.round(seconds / 60)} minutes`;
  if (seconds < 48 * 3600) return `about ${Math.round(seconds / 3600)} hours`;
  return `about ${Math.round(seconds / 86_400)} days`;
}
