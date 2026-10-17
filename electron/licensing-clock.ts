import type { LicenceClaims } from './licensing-verification.js';

// Clock rules for licences (ADR-523, ADR-523 Amendment 2). Only a trial ends by
// the clock: a paid or developer licence never expires. Trial and paid devices
// must still confirm their rights online now and then before choosing new Pro
// tools (ADR-592); existing work and output never wait for that.

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
 * the paid check-in or its weekly refresh (ADR-592). Developer rights have no
 * check-in, and a trial saves its own mark every second.
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
 * How long a device may go without the licence service confirming its rights
 * before new Pro choices pause (ADR-592). The signed `issuedAt` of the last grant
 * is the confirmation, so it cannot be moved on by editing saved files.
 * Developer licences are exempt.
 */
export const CHECK_IN_LIMIT: Readonly<Partial<Record<LicenceClaims['tier'], number>>> = {
  trial: 3 * DAY,
  paid: 30 * DAY,
};

/**
 * True when this device must reach the licence service before choosing new Pro
 * tools: its last confirmation is older than the limit, or this computer's clock
 * is earlier than that confirmation. A paid grant accepted while this clock was
 * off (see `paidClockOffset`) is measured from the local time it arrived: the
 * signed `issuedAt` moved by the offset saved with it.
 */
export function checkInOverdue(
  claims: Pick<LicenceClaims, 'tier' | 'issuedAt'>,
  lastSeenAt: number,
  now: number,
  clockOffset = 0,
): boolean {
  const limit = CHECK_IN_LIMIT[claims.tier];
  if (limit === undefined) return false;
  const confirmedAt = confirmedHere(claims, limit, clockOffset);
  return Math.max(now, lastSeenAt) - confirmedAt > limit || now + CLOCK_TOLERANCE < confirmedAt;
}

/** When, on this computer's clock, new Pro choices pause without a check-in; null if never. */
export function checkInDueAt(
  claims: Pick<LicenceClaims, 'tier' | 'issuedAt'>,
  clockOffset = 0,
): number | null {
  const limit = CHECK_IN_LIMIT[claims.tier];
  return limit === undefined ? null : confirmedHere(claims, limit, clockOffset) + limit;
}

function confirmedHere(
  claims: Pick<LicenceClaims, 'tier' | 'issuedAt'>,
  limit: number,
  clockOffset: number,
): number {
  const shift = claims.tier === 'paid' ? Math.max(-limit, Math.min(limit, clockOffset)) : 0;
  return claims.issuedAt + shift;
}

/**
 * The offset to save with a paid refresh grant that verified apart from this
 * computer's clock, or null when the grant is refused as before. The service
 * did confirm the licence, so the check-in counts, but the clock is still not
 * trusted: the next check-in is measured from when the grant arrived here. A
 * trial is never accepted this way, so a wrong clock cannot extend it, and an
 * offset beyond one check-in period is refused, so an edited offset buys at
 * most one more period.
 */
export function paidClockOffset(
  claims: Pick<LicenceClaims, 'tier'>,
  offset: number,
): number | null {
  const limit = CHECK_IN_LIMIT[claims.tier];
  return claims.tier === 'paid' && limit !== undefined && Math.abs(offset) <= limit ? offset : null;
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

/** Shown while a paid licence's last confirmation arrived with this computer's clock off. */
export function clockWarningMessage(offset: number): string {
  return `This computer’s clock is ${roughly(Math.abs(offset))} ${offset > 0 ? 'ahead' : 'behind'}. Your licence was confirmed anyway, but turn on Set time automatically in Windows’ Date & time settings and check the time zone so later licence checks keep working.`;
}

// Called only for more than five minutes, so every unit rounds to two or more.
function roughly(seconds: number): string {
  if (seconds < 90 * 60) return `about ${Math.round(seconds / 60)} minutes`;
  if (seconds < 48 * 3600) return `about ${Math.round(seconds / 3600)} hours`;
  return `about ${Math.round(seconds / 86_400)} days`;
}
