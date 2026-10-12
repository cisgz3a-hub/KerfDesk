import { checkGrantTime } from './licensing-clock.js';
import type { LicencePayment } from './licensing-commerce.js';
import type { LicensingConfig } from './licensing-config.js';
import { displayDeviceName, RELEASED, REVOKED } from './licensing-messages.js';
import { validLicenceKey, type LicenceCredential, type LicenceRecord } from './licensing-store.js';
import { record, verifyEntitlement, type LicenceClaims } from './licensing-verification.js';

// The requests that ask the licence service for rights, and the saved record a
// verified answer leaves (ADR-523, ADR-523 Amendment 2).

export type GrantAction = 'activate' | 'trial' | 'refresh';
export type VerifiedGrant = {
  readonly credential: LicenceCredential;
  readonly claims: LicenceClaims;
};
type ActivationBody = {
  readonly licenseId: string;
  readonly activationId: string;
  readonly deviceId: string;
  readonly activationToken: string;
};

/** Proof of this device's seat, or null once the saved credential no longer verifies here. */
export function activationBody(
  config: LicensingConfig,
  credential: LicenceCredential,
  deviceId: string,
): ActivationBody | null {
  if (config.channel !== 'commercial') throw new Error('Commercial licensing unavailable');
  const claims = verifyEntitlement(credential.entitlement, config.entitlementKeys, deviceId);
  return claims === null
    ? null
    : {
        licenseId: claims.licenseId,
        activationId: claims.activationId,
        deviceId,
        activationToken: credential.activationToken,
      };
}

export function requireActivationBody(
  config: LicensingConfig,
  credential: LicenceCredential,
  deviceId: string,
): ActivationBody {
  const body = activationBody(config, credential, deviceId);
  if (body === null) throw new Error('Invalid saved licence');
  return body;
}

/** A renewal checkout names this device's seat; a purchase or an unactivated device names nothing. */
export function renewalIdentity(
  config: LicensingConfig,
  operation: string,
  saved: LicenceRecord,
  device: string,
): ActivationBody | undefined {
  return operation === 'renewal' && saved.credential !== undefined
    ? requireActivationBody(config, saved.credential, device)
    : undefined;
}

/** The service call for an action, or null when a refresh has nothing to refresh. */
export function grantRequest(
  config: LicensingConfig,
  request: {
    readonly action: GrantAction;
    readonly saved: LicenceRecord;
    readonly device: string;
    readonly deviceName: string;
    readonly licenseKey?: string | undefined;
    /** The firmware digest a trial is also bound to, when this computer has one (ADR-592). */
    readonly hardwareId?: string | null | undefined;
  },
): { readonly path: string; readonly body: unknown } | null {
  const { action, saved, device } = request;
  if (action === 'refresh')
    return saved.credential === undefined
      ? null
      : {
          path: '/v1/activations/refresh',
          body: requireActivationBody(config, saved.credential, device),
        };
  return {
    path: action === 'trial' ? '/v1/trials/start' : '/v1/licenses/activate',
    body: {
      deviceId: device,
      deviceName: displayDeviceName(request.deviceName),
      ...(action === 'activate' ? { licenseKey: request.licenseKey } : {}),
      ...(action === 'trial' && typeof request.hardwareId === 'string'
        ? { hardwareId: request.hardwareId }
        : {}),
    },
  };
}

/**
 * Checks a service grant for this device. A grant issued more than five
 * minutes from this computer's clock throws LicenceClockError, for every tier.
 */
export function verifyGrant(
  config: LicensingConfig,
  value: unknown,
  device: string,
  now: number,
): VerifiedGrant {
  if (
    config.channel !== 'commercial' ||
    !record(value) ||
    typeof value.activationToken !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.activationToken)
  )
    throw new Error('Invalid activation');
  const claims = verifyEntitlement(value.entitlement, config.entitlementKeys, device);
  if (claims === null) throw new Error('Invalid entitlement');
  checkGrantTime(claims.issuedAt, now);
  return {
    credential: {
      entitlement: value.entitlement as LicenceCredential['entitlement'],
      activationToken: value.activationToken,
    },
    claims,
  };
}

/**
 * The record a verified grant leaves. A fresh grant ends any stuck
 * deactivation, and a key that unlocks paid Pro drops an unfinished purchase,
 * which would otherwise hide Renew (ADR-523 Amendment 2).
 */
export function grantedRecord(
  action: GrantAction,
  saved: LicenceRecord,
  grant: VerifiedGrant,
  now: number,
  licenseKey?: string,
): { readonly next: LicenceRecord; readonly droppedOrder: LicencePayment | null } {
  const { pendingDeactivation: _pending, payment, ...rest } = saved;
  const stale =
    action === 'activate' && grant.claims.tier !== 'trial' && payment?.operation === 'purchase';
  const next: LicenceRecord = {
    ...rest,
    schemaVersion: 1,
    // A freshly signed online grant can recover a corrected system clock.
    lastSeenAt: now,
    refreshedAt: now,
    credential: grant.credential,
    ...(payment === undefined || stale ? {} : { payment }),
    ...(action === 'activate' && validLicenceKey(licenseKey) ? { licenseKey } : {}),
  };
  return { next, droppedOrder: stale ? (payment ?? null) : null };
}

/** A definitive refusal removes saved rights; an outage leaves them intact. */
export function revokedRecord(
  saved: LicenceRecord,
  code: string,
  now: number,
): LicenceRecord | null {
  const revoked = REVOKED.has(code);
  if (!revoked && !RELEASED.has(code)) return null;
  const { credential: _credential, licenseKey, ...rest } = saved;
  // A released seat keeps its activation key; a revoked licence's key is useless.
  return {
    ...rest,
    refreshedAt: now,
    ...(revoked || licenseKey === undefined ? {} : { licenseKey }),
  };
}

/** A failed disk write cannot re-arm a grant this process saw the service reject. */
export function withoutRejectedEntitlement(
  saved: LicenceRecord,
  rejectedPayload: string | null,
): LicenceRecord {
  if (rejectedPayload === null || saved.credential?.entitlement.payload !== rejectedPayload)
    return saved;
  const { credential: _credential, ...rest } = saved;
  return rest;
}
