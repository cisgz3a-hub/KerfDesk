import { clockRolledBack } from './licensing-clock.js';
import type { LicensingConfig } from './licensing-config.js';
import type { LicenceRecord } from './licensing-store.js';
import {
  licenceCoversRelease,
  verifyEntitlement,
  verifyLicenceRelease,
  type LicenceClaims,
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
    | 'clock-error';
  readonly tier: 'trial' | 'paid' | 'developer' | null;
  readonly accessExpiresAt: number | null;
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
    // A build without commercial metadata is a Preview or source build with
    // every feature; a commercial build unlocks Pro only with valid rights.
    edition: free || pro ? 'pro' : 'free',
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
  if (claims.accessExpiresAt !== null && now >= claims.accessExpiresAt)
    return summary(
      'trial-expired',
      claims,
      'Your 30-day Pro trial has ended. KerfDesk Free keeps working. Buy a licence or enter your key to use the Pro tools again.',
    );
  if (!licenceCoversRelease(claims, release))
    return summary('updates-expired', claims, updatesExpiredMessage(claims));
  return summary('ready', claims);
}

function updatesExpiredMessage(claims: LicenceClaims): string {
  const until = claims.updatesUntil === null ? 'its update date' : date(claims.updatesUntil);
  return `Your licence includes KerfDesk versions released until ${until}. This version is newer, so Pro tools are locked here. Renew updates, or install a version your licence covers.`;
}
