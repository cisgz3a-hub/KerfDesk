import {
  automaticTimeSetting,
  CHECK_IN_LIMIT,
  checkInDueAt,
  checkInOverdue,
  clockRolledBack,
} from './licensing-clock.js';
import type { LicensingConfig } from './licensing-config.js';
import { licenceWindowText } from './licence-window.js';
import type { LicenceRecord } from './licensing-store.js';
import {
  licenceCoversRelease,
  verifyEntitlement,
  verifyLicenceRelease,
  type LicenceClaims,
  type VerifiedRelease,
} from './licensing-verification.js';

/**
 * What the renderer learns about this device's licence (ADR-540). With the
 * licence window on, a commercial desktop app opens its workspace only once
 * `edition` is Pro (ADR-623); while ADR-623 Amendment 3 holds it off, the app
 * always opens and `edition` only unlocks the Pro tools. No state here gates a
 * machine operation or an open workspace.
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
   * licence service confirms these rights first (ADR-592). Only a trial has a
   * check-in; paid and developer rights never carry one (ADR-623 Amendment 2).
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
  /** `process.platform`, so clock advice names this computer's own settings. */
  platform: string,
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
      licenceWindowText(
        'This KerfDesk build is not configured for licences, so it cannot be activated. Install an official KerfDesk release.',
        'This KerfDesk build is not configured for licences, so Pro tools are locked. Everything else works. Install an official KerfDesk release to use Pro.',
      ),
    );
  const release = verifyLicenceRelease(config.release, config.releaseKeys);
  if (release === null || release.version !== version)
    return summary(
      'unavailable',
      null,
      licenceWindowText(
        'This build has no valid signed release identity, so it cannot be activated. Install an official KerfDesk release.',
        'This build has no valid signed release identity, so Pro tools are locked. Install an official KerfDesk release to use Pro.',
      ),
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
      `This computer’s clock is earlier than the last licence check, so ${licenceWindowText('your trial cannot be used', 'the Pro tools in your trial are locked')}. Turn on ${automaticTimeSetting(platform)}, then choose Refresh licence.`,
    );
  if (claims.accessExpiresAt !== null && Math.max(now, saved.lastSeenAt) >= claims.accessExpiresAt)
    return summary(
      'trial-expired',
      claims,
      licenceWindowText(
        'Your 30-day trial has ended. Buy a licence or enter your licence key to keep using KerfDesk.',
        'Your 30-day Pro trial has ended. KerfDesk Free keeps working. Buy a licence or enter your key to use the Pro tools again.',
      ),
    );
  return withCheckInDue(
    summary(...currentRights(claims, release, saved.lastSeenAt, now, platform)),
    claims,
  );
}

function withCheckInDue(status: LicenceStatus, claims: LicenceClaims): LicenceStatus {
  const due = checkInDueAt(claims);
  return due === null ? status : { ...status, checkInDueAt: due };
}

/**
 * Rights that verified and have not ended: a trial due a check-in, beyond their
 * updates, or ready. A paid licence is never due a check-in and never reads the
 * clock here, so offline or with a wrong clock it opens as usual (ADR-623
 * Amendment 2); only its update period can stop a newer release.
 */
function currentRights(
  claims: LicenceClaims,
  release: VerifiedRelease,
  lastSeenAt: number,
  now: number,
  platform: string,
): [LicenceStatus['state'], LicenceClaims, string | null] {
  if (checkInOverdue(claims, lastSeenAt, now))
    return ['checkin-required', claims, checkInMessage(claims, platform)];
  if (!licenceCoversRelease(claims, release))
    return ['updates-expired', claims, updatesExpiredMessage(claims)];
  return ['ready', claims, null];
}

/** Only a trial has a check-in (ADR-592, ADR-623 Amendment 2). */
function checkInMessage(claims: LicenceClaims, platform: string): string {
  const days = Math.round((CHECK_IN_LIMIT[claims.tier] ?? 0) / 86_400);
  return `KerfDesk has not confirmed this trial with the licence service for more than ${days} days, ${licenceWindowText('so it needs a check before KerfDesk opens again. An open KerfDesk keeps its projects, Frame and Start.', 'so new Pro tools are paused. Your projects, Frame and Start keep working.')} Connect to the internet and choose Refresh licence. If this computer’s clock is wrong, turn on ${automaticTimeSetting(platform)} first.`;
}

function updatesExpiredMessage(claims: LicenceClaims): string {
  const until = claims.updatesUntil === null ? 'its update date' : date(claims.updatesUntil);
  return `Your licence includes KerfDesk versions released until ${until}. This version is newer, so ${licenceWindowText('your licence cannot open it', 'Pro tools are locked here')}. Renew updates, or install a version your licence covers.`;
}
