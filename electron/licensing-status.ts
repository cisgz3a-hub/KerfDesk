import type { LicensingConfig } from './licensing-config.js';
import type { LicenceRecord } from './licensing-store.js';
import {
  licenceCoversRelease,
  verifyEntitlement,
  verifyLicenceRelease,
  type LicenceClaims,
} from './licensing-verification.js';

export type LicenceStatus = {
  readonly channel: 'free' | 'commercial';
  readonly state:
    | 'ready'
    | 'activation-required'
    | 'trial-expired'
    | 'updates-expired'
    | 'invalid-licence'
    | 'unavailable'
    | 'clock-error';
  readonly sessionAuthorized: boolean;
  readonly tier: 'trial' | 'paid' | 'developer' | null;
  readonly accessExpiresAt: number | null;
  readonly updatesUntil: number | null;
  readonly perpetualUpdates: boolean;
  readonly deactivationPending: boolean;
  readonly paymentPending: boolean;
  readonly message: string | null;
};

export function licenceSummary(
  config: LicensingConfig,
  authorized: boolean,
  state: LicenceStatus['state'],
  claims: LicenceClaims | null = null,
  pending = false,
  message: string | null = null,
): LicenceStatus {
  const rights = claims ?? {
    tier: null,
    accessExpiresAt: null,
    updatesUntil: null,
    perpetualUpdates: false,
  };
  return {
    channel: config.channel === 'free' ? 'free' : 'commercial',
    state,
    sessionAuthorized: authorized,
    tier: rights.tier,
    accessExpiresAt: rights.accessExpiresAt,
    updatesUntil: rights.updatesUntil,
    perpetualUpdates: rights.perpetualUpdates,
    deactivationPending: pending,
    paymentPending: false,
    message,
  };
}

export function evaluateLicence(
  config: LicensingConfig,
  version: string,
  saved: LicenceRecord,
  device: string,
  now: number,
  authorized: boolean,
): LicenceStatus {
  const summary = (
    state: LicenceStatus['state'],
    claims: LicenceClaims | null = null,
    pending = false,
    message: string | null = null,
  ): LicenceStatus => ({
    ...licenceSummary(config, authorized, state, claims, pending, message),
    paymentPending: saved.payment !== undefined,
  });
  if (config.channel === 'free') return summary('ready');
  if (config.channel !== 'commercial')
    return summary(
      'unavailable',
      null,
      false,
      'This commercial build is not configured correctly. Contact KerfDesk support.',
    );
  const release = verifyLicenceRelease(config.release, config.releaseKeys);
  if (release === null || release.version !== version)
    return summary(
      'unavailable',
      null,
      false,
      'This build has no valid signed release identity. Install an official KerfDesk release.',
    );
  if (saved.pendingDeactivation !== undefined)
    return summary(
      'activation-required',
      null,
      true,
      'This device is signed out locally. Connect and retry deactivation to free its licence seat.',
    );
  if (saved.credential === undefined) return summary('activation-required');
  const claims = verifyEntitlement(saved.credential.entitlement, config.entitlementKeys, device);
  if (claims === null)
    return summary(
      'invalid-licence',
      null,
      false,
      'The saved licence is invalid for this device. Activate a valid licence.',
    );
  if (now + 300 < Math.max(saved.lastSeenAt, claims.issuedAt))
    return summary(
      'clock-error',
      claims,
      false,
      'The computer clock is earlier than the last licence check. Correct the clock and try again.',
    );
  if (claims.accessExpiresAt !== null && now >= claims.accessExpiresAt)
    return summary(
      'trial-expired',
      claims,
      false,
      'Your 30-day trial has ended. Activate a licence to continue.',
    );
  if (!licenceCoversRelease(claims, release))
    return summary(
      'updates-expired',
      claims,
      false,
      'This release is newer than your included updates. Use an eligible version or renew updates, then refresh your licence.',
    );
  return summary('ready', claims);
}
