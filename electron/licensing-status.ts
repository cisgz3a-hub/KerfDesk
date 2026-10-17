import {
  CHECK_IN_LIMIT,
  CLOCK_TOLERANCE,
  checkInDueAt,
  checkInOverdue,
  clockRolledBack,
  clockWarningMessage,
} from './licensing-clock.js';
import type { LicensingConfig } from './licensing-config.js';
import type { LicenceRecord } from './licensing-store.js';
import {
  licenceCoversRelease,
  verifyEntitlement,
  verifyLicenceRelease,
  type LicenceClaims,
  type VerifiedRelease,
} from './licensing-verification.js';

/**
 * What the renderer learns about this device's licence (ADR-540). The app
 * always opens: `edition` only says whether the Pro tools are unlocked for this
 * session. No state here gates a machine operation or an open workspace.
 */
export type LicenceStatus = {
  readonly channel: 'free' | 'commercial';
  readonly edition: 'pro' | 'free';
  readonly state:
    | 'ready'
    | 'activation-required'
    | 'trial-expired'
    | 'updates-expired'
    | 'invalid-licence'
    | 'unavailable'
    | 'clock-error'
    | 'checkin-required';
  readonly tier: 'trial' | 'paid' | 'developer' | null;
  readonly accessExpiresAt: number | null;
  /** Current main-process trial budget; the signed original deadline is unchanged. */
  readonly trialExpiresInMs?: number;
  /**
   * Unix seconds on this computer's clock when new Pro choices pause unless the
   * licence service confirms these rights first (ADR-592). Absent without a check-in.
   */
  readonly checkInDueAt?: number;
  readonly updatesUntil: number | null;
  readonly perpetualUpdates: boolean;
  /** The saved licence key, so a buyer can activate their other devices. */
  readonly licenseKey: string | null;
  readonly deactivationPending: boolean;
  readonly paymentPending: boolean;
  /** The saved order's id, quoted to support if a payment never arrives. */
  readonly paymentOrderId: string | null;
  /** The saved licence record cannot be read and may be cleared. */
  readonly storeUnreadable: boolean;
  readonly message: string | null;
};

type ExtraFields = Pick<
  LicenceStatus,
  'licenseKey' | 'paymentPending' | 'paymentOrderId' | 'storeUnreadable' | 'deactivationPending'
>;
type Extras = Partial<ExtraFields>;
const NO_EXTRAS: ExtraFields = {
  licenseKey: null,
  deactivationPending: false,
  paymentPending: false,
  paymentOrderId: null,
  storeUnreadable: false,
};

export function licenceSummary(
  config: LicensingConfig,
  pro: boolean,
  state: LicenceStatus['state'],
  claims: LicenceClaims | null = null,
  message: string | null = null,
  extras: Extras = {},
): LicenceStatus {
  const rights = claims ?? {
    tier: null,
    accessExpiresAt: null,
    updatesUntil: null,
    perpetualUpdates: false,
  };
  const free = config.channel === 'free';
  return {
    channel: free ? 'free' : 'commercial',
    // Free/Preview/source builds have no licence authority and remain Free
    // (ADR-540 Amendment 1). Only the commercial runtime may unlock Pro.
    edition:
      config.channel === 'commercial' && pro && (rights.tier !== 'trial' || state === 'ready')
        ? 'pro'
        : 'free',
    state,
    tier: rights.tier,
    accessExpiresAt: rights.accessExpiresAt,
    updatesUntil: rights.updatesUntil,
    perpetualUpdates: rights.perpetualUpdates,
    ...NO_EXTRAS,
    ...extras,
    message,
  };
}

function date(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

export function evaluateLicence(
  config: LicensingConfig,
  version: string,
  saved: LicenceRecord,
  device: string,
  now: number,
  proLatched: boolean,
): LicenceStatus {
  const summary = (
    state: LicenceStatus['state'],
    claims: LicenceClaims | null = null,
    message: string | null = null,
  ): LicenceStatus =>
    licenceSummary(config, proLatched || state === 'ready', state, claims, message, {
      licenseKey: saved.licenseKey ?? null,
      deactivationPending: saved.pendingDeactivation !== undefined,
      paymentPending: saved.payment !== undefined,
      paymentOrderId: saved.payment?.order?.orderId ?? null,
    });
  if (config.channel === 'free') return summary('ready');
  if (config.channel !== 'commercial')
    return summary(
      'unavailable',
      null,
      'This KerfDesk build is not configured for licences, so Pro tools are locked. Everything else works. Install an official KerfDesk release to use Pro.',
    );
  const release = verifyLicenceRelease(config.release, config.releaseKeys);
  if (release === null || release.version !== version)
    return summary(
      'unavailable',
      null,
      'This build has no valid signed release identity, so Pro tools are locked. Install an official KerfDesk release to use Pro.',
    );
  if (saved.pendingDeactivation !== undefined)
    return summary(
      'activation-required',
      null,
      'This computer is signed out of its licence. Connect to the internet and retry deactivation to free its seat, or choose Reset saved licence to stop trying.',
    );
  if (saved.credential === undefined) return summary('activation-required');
  const claims = verifyEntitlement(saved.credential.entitlement, config.entitlementKeys, device);
  if (claims === null)
    return summary(
      'invalid-licence',
      null,
      'The saved licence cannot be used on this computer. Enter your licence key to activate it again.',
    );
  // Only a trial is held to the clock; paid and developer rights never expire.
  if (clockRolledBack(claims, saved.lastSeenAt, now))
    return summary(
      'clock-error',
      claims,
      'This computer’s clock is earlier than the last licence check, so the Pro tools in your trial are locked. Turn on Set time automatically in Windows’ Date & time settings, then choose Refresh licence.',
    );
  if (claims.accessExpiresAt !== null && Math.max(now, saved.lastSeenAt) >= claims.accessExpiresAt)
    return summary(
      'trial-expired',
      claims,
      'Your 30-day Pro trial has ended. KerfDesk Free keeps working. Buy a licence or enter your key to use the Pro tools again.',
    );
  return withCheckInDue(summary(...currentRights(claims, release, saved, now)), claims, saved);
}

/** A paid grant's saved clock offset (ADR-592); a trial is never measured by one. */
function paidOffset(claims: LicenceClaims, saved: LicenceRecord): number {
  return claims.tier === 'paid' ? (saved.clockOffset ?? 0) : 0;
}

function withCheckInDue(
  status: LicenceStatus,
  claims: LicenceClaims,
  saved: LicenceRecord,
): LicenceStatus {
  const due = checkInDueAt(claims, paidOffset(claims, saved));
  return due === null ? status : { ...status, checkInDueAt: due };
}

/** Rights that verified and have not ended: due a check-in, beyond their updates, or ready. */
function currentRights(
  claims: LicenceClaims,
  release: VerifiedRelease,
  saved: LicenceRecord,
  now: number,
): [LicenceStatus['state'], LicenceClaims, string | null] {
  const offset = paidOffset(claims, saved);
  if (checkInOverdue(claims, saved.lastSeenAt, now, offset))
    return ['checkin-required', claims, checkInMessage(claims)];
  if (!licenceCoversRelease(claims, release))
    return ['updates-expired', claims, updatesExpiredMessage(claims)];
  // The last confirmation arrived with this clock off: keep saying so.
  return ['ready', claims, Math.abs(offset) > CLOCK_TOLERANCE ? clockWarningMessage(offset) : null];
}

function checkInMessage(claims: LicenceClaims): string {
  const days = Math.round((CHECK_IN_LIMIT[claims.tier] ?? 0) / 86_400);
  return `KerfDesk has not confirmed this ${claims.tier === 'trial' ? 'trial' : 'licence'} with the licence service for more than ${days} days, so new Pro tools are paused. Your projects, Frame and Start keep working. Connect to the internet and choose Refresh licence. If this computer’s clock is wrong, turn on Set time automatically in Windows’ Date & time settings first.`;
}

function updatesExpiredMessage(claims: LicenceClaims): string {
  const until = claims.updatesUntil === null ? 'its update date' : date(claims.updatesUntil);
  return `Your licence includes KerfDesk versions released until ${until}. This version is newer, so Pro tools are locked here. Renew updates, or install a version your licence covers.`;
}
