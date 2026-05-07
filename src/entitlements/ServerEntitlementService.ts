/**
 * T2-89: stack-agnostic entitlement server contract.
 *
 * This module is intentionally framework-free. A Cloudflare Worker,
 * Vercel Function, Lambda, or other server adapter can parse HTTP
 * requests and delegate here while keeping Gumroad access, business
 * rules, and private-key signing out of the client bundle.
 */
import type { EntitlementTokenPayload, SignedEntitlementToken } from './SignedEntitlementToken';
import type { ProFeature } from './types';

export const ENTITLEMENT_ACTIVATE_PATH = '/entitlement/activate';
export const ENTITLEMENT_REFRESH_PATH = '/entitlement/refresh';
export const ENTITLEMENT_PUBLIC_KEY_PATH = '/entitlement/public-key';

export interface EntitlementActivationRequest {
  readonly licenseCode: string;
  readonly deviceId?: string;
}

export interface EntitlementRefreshRequest {
  readonly token: SignedEntitlementToken;
}

export interface EntitlementPublicKeyResponse {
  readonly kid: string;
  readonly alg: 'EdDSA' | 'ES256';
  readonly publicKeyPem: string;
}

export interface GumroadLicenseRecord {
  readonly licenseId: string;
  readonly purchaserEmail?: string;
  readonly productId?: string;
  readonly refunded?: boolean;
  readonly chargebacked?: boolean;
  readonly disputed?: boolean;
}

export type GumroadLicenseVerification =
  | { readonly ok: true; readonly record: GumroadLicenseRecord }
  | {
      readonly ok: false;
      readonly reason: 'invalid' | 'not-found' | 'network-error' | 'server-error';
      readonly message?: string;
    };

export interface GumroadLicenseVerifier {
  verifyLicense(licenseCode: string): Promise<GumroadLicenseVerification>;
}

export type EntitlementBusinessRuleFailureReason =
  | 'manual-revocation'
  | 'device-limit-exceeded'
  | 'plan-not-entitled';

export type EntitlementBusinessRuleDecision =
  | {
      readonly ok: true;
      readonly tier: EntitlementTokenPayload['tier'];
      readonly features: readonly ProFeature[];
    }
  | {
      readonly ok: false;
      readonly reason: EntitlementBusinessRuleFailureReason;
      readonly message?: string;
    };

export interface EntitlementBusinessRules {
  evaluate(input: {
    readonly licenseCode: string;
    readonly deviceId?: string;
    readonly gumroad: GumroadLicenseRecord;
  }): EntitlementBusinessRuleDecision;
}

export interface ServerEntitlementSigner {
  signEntitlement(payload: EntitlementTokenPayload): Promise<SignedEntitlementToken>;
}

export interface ActivateServerEntitlementOptions {
  readonly request: EntitlementActivationRequest;
  readonly gumroad: GumroadLicenseVerifier;
  readonly businessRules: EntitlementBusinessRules;
  readonly signer: ServerEntitlementSigner;
  readonly now: number;
  readonly tokenTtlMs: number;
  readonly jtiFactory: () => string;
}

export interface RefreshServerEntitlementOptions {
  /**
   * The endpoint adapter verifies the submitted token first, then passes
   * the trusted payload here to rotate jti/expiry.
   */
  readonly currentPayload: EntitlementTokenPayload;
  readonly signer: ServerEntitlementSigner;
  readonly now: number;
  readonly tokenTtlMs: number;
  readonly jtiFactory: () => string;
}

export type ServerEntitlementFailureReason =
  | 'invalid-license-code'
  | 'gumroad-invalid'
  | 'gumroad-not-found'
  | 'gumroad-network-error'
  | 'gumroad-server-error'
  | 'gumroad-revoked'
  | EntitlementBusinessRuleFailureReason
  | 'token-expired';

export type ServerEntitlementResponse =
  | {
      readonly ok: true;
      readonly status: 'verified';
      readonly token: SignedEntitlementToken;
      readonly features: readonly ProFeature[];
      readonly expiresAt: number;
    }
  | {
      readonly ok: false;
      readonly status: 'revoked' | 'verification_failed';
      readonly reason: ServerEntitlementFailureReason;
      readonly message?: string;
    };

export function normalizeLicenseCode(code: string): string {
  return code.trim().toUpperCase();
}

export async function activateServerEntitlement(
  opts: ActivateServerEntitlementOptions,
): Promise<ServerEntitlementResponse> {
  const licenseCode = normalizeLicenseCode(opts.request.licenseCode);
  if (licenseCode.length === 0) {
    return {
      ok: false,
      status: 'verification_failed',
      reason: 'invalid-license-code',
      message: 'License code is required.',
    };
  }

  const gumroad = await opts.gumroad.verifyLicense(licenseCode);
  if (!gumroad.ok) {
    return {
      ok: false,
      status: 'verification_failed',
      reason: gumroadFailureReason(gumroad.reason),
      message: gumroad.message,
    };
  }

  if (isRevokedGumroadRecord(gumroad.record)) {
    return {
      ok: false,
      status: 'revoked',
      reason: 'gumroad-revoked',
      message: 'Purchase is refunded, disputed, or chargebacked.',
    };
  }

  const policy = opts.businessRules.evaluate({
    licenseCode,
    deviceId: opts.request.deviceId,
    gumroad: gumroad.record,
  });
  if (!policy.ok) {
    return {
      ok: false,
      status: 'verification_failed',
      reason: policy.reason,
      message: policy.message,
    };
  }

  return signResponse({
    signer: opts.signer,
    payload: {
      sub: gumroad.record.licenseId,
      tier: policy.tier,
      features: policy.features,
      iat: opts.now,
      exp: opts.now + opts.tokenTtlMs,
      jti: opts.jtiFactory(),
      ...(opts.request.deviceId !== undefined ? { deviceId: opts.request.deviceId } : {}),
    },
    features: policy.features,
  });
}

export async function refreshServerEntitlement(
  opts: RefreshServerEntitlementOptions,
): Promise<ServerEntitlementResponse> {
  if (opts.currentPayload.exp <= opts.now) {
    return {
      ok: false,
      status: 'verification_failed',
      reason: 'token-expired',
      message: 'Existing entitlement token is expired.',
    };
  }

  const features = opts.currentPayload.features as readonly ProFeature[];
  return signResponse({
    signer: opts.signer,
    payload: {
      ...opts.currentPayload,
      iat: opts.now,
      exp: opts.now + opts.tokenTtlMs,
      jti: opts.jtiFactory(),
    },
    features,
  });
}

function isRevokedGumroadRecord(record: GumroadLicenseRecord): boolean {
  return record.refunded === true || record.chargebacked === true || record.disputed === true;
}

function gumroadFailureReason(reason: GumroadLicenseVerification extends infer T
  ? T extends { ok: false; reason: infer R } ? R : never
  : never): ServerEntitlementFailureReason {
  switch (reason) {
    case 'invalid': return 'gumroad-invalid';
    case 'not-found': return 'gumroad-not-found';
    case 'network-error': return 'gumroad-network-error';
    case 'server-error': return 'gumroad-server-error';
  }
}

async function signResponse(opts: {
  readonly signer: ServerEntitlementSigner;
  readonly payload: EntitlementTokenPayload;
  readonly features: readonly ProFeature[];
}): Promise<ServerEntitlementResponse> {
  return {
    ok: true,
    status: 'verified',
    token: await opts.signer.signEntitlement(opts.payload),
    features: opts.features,
    expiresAt: opts.payload.exp,
  };
}
