import type { LicenceClaims } from './licensing-verification.js';

// Clock rules for licences (ADR-523, ADR-523 Amendment 2). Only a trial ends by
// the clock: a paid or developer licence never expires. A trial must still
// confirm its rights online now and then before choosing new Pro tools
// (ADR-592); a paid licence never has to, and keeps working offline whatever the
// clock says (ADR-623 Amendment 2). Existing work and output never wait for it.

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

/**
 * A paid licence's new last-seen mark, or null when nothing needs saving. It is
 * saved at most every five minutes, so winding the clock back cannot hold off
 * the quiet refresh that fetches a refund (ADR-592). It never locks anything
 * (ADR-623 Amendment 2). Developer rights have no mark, and a trial saves its
 * own mark every second.
 */
export function nextPaidMark(
  rights: Pick<LicenceClaims, 'tier'>,
  lastSeenAt: number,
  now: number,
): number | null {
  return rights.tier === 'paid' && now >= lastSeenAt + CLOCK_TOLERANCE ? now : null;
}

const DAY = 86_400;
/**
 * How long a trial may go without the licence service confirming its rights
 * before new Pro choices pause (ADR-592). The signed `issuedAt` of the last grant
 * is the confirmation, so it cannot be moved on by editing saved files. Paid and
 * developer licences have none: like LightBurn's, a paid licence activated here
 * keeps working offline indefinitely (ADR-623 Amendment 2).
 */
export const CHECK_IN_LIMIT: Readonly<Partial<Record<LicenceClaims['tier'], number>>> = {
  trial: 3 * DAY,
};

/**
 * True when this trial must reach the licence service before choosing new Pro
 * tools: its last confirmation is older than the limit, or this computer's clock
 * is earlier than that confirmation. Never true for paid or developer rights.
 */
export function checkInOverdue(
  claims: Pick<LicenceClaims, 'tier' | 'issuedAt'>,
  lastSeenAt: number,
  now: number,
): boolean {
  const limit = CHECK_IN_LIMIT[claims.tier];
  if (limit === undefined) return false;
  const confirmedAt = claims.issuedAt;
  return Math.max(now, lastSeenAt) - confirmedAt > limit || now + CLOCK_TOLERANCE < confirmedAt;
}

/** When, on this computer's clock, new Pro choices pause without a check-in; null if never. */
export function checkInDueAt(claims: Pick<LicenceClaims, 'tier' | 'issuedAt'>): number | null {
  const limit = CHECK_IN_LIMIT[claims.tier];
  return limit === undefined ? null : claims.issuedAt + limit;
}

/**
 * True when a fresh grant is held to this computer's clock. A paid grant is
 * not: paid rights never end and have no check-in, so the clock cannot change
 * what they allow, and a paying customer is never refused for a wrong clock
 * (ADR-623 Amendment 2). A trial's deadline, and a developer grant, still are.
 */
export function grantTimeChecked(claims: Pick<LicenceClaims, 'tier'>): boolean {
  return claims.tier !== 'paid';
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

/**
 * The setting that keeps this computer's clock right, where its own system keeps
 * it (`process.platform`): KerfDesk ships for Windows, macOS and Linux, and each
 * Linux desktop names it a little differently.
 */
export function automaticTimeSetting(platform: string): string {
  if (platform === 'win32') return 'Set time automatically in Windows’ Date & time settings';
  if (platform === 'darwin')
    return 'Set time and date automatically in System Settings > General > Date & Time';
  return 'automatic date and time in your desktop’s date and time settings';
}

export function clockErrorMessage(offset: number, platform: string): string {
  return `This computer’s clock is ${roughly(Math.abs(offset))} ${offset > 0 ? 'ahead' : 'behind'}, so the licence could not be confirmed. Turn on ${automaticTimeSetting(platform)}, check the time zone, then try again.`;
}

// Called only for more than five minutes, so every unit rounds to two or more.
function roughly(seconds: number): string {
  if (seconds < 90 * 60) return `about ${Math.round(seconds / 60)} minutes`;
  if (seconds < 48 * 3600) return `about ${Math.round(seconds / 3600)} hours`;
  return `about ${Math.round(seconds / 86_400)} days`;
}
