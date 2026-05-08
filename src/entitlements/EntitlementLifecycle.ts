/**
 * T2-96: subscription / plan lifecycle support.
 *
 * T2-89 issues server-signed tokens. T2-96 adds the lifecycle
 * contract around those tokens: revocation polling, local revocation
 * persistence, and typed events for refunds, chargebacks, manual
 * revocation, plan changes, and expiry.
 */
import type { EntitlementTokenPayload, SignedEntitlementToken } from './SignedEntitlementToken';
import type { EntitlementState, ProFeature } from './types';

export const ENTITLEMENT_REVOCATIONS_PATH = '/entitlement/revocations';

export type EntitlementRevocationReason =
  | 'refunded'
  | 'chargebacked'
  | 'disputed'
  | 'manual';

export interface EntitlementRevocation {
  readonly jti: string;
  readonly revokedAt: number;
  readonly reason: EntitlementRevocationReason;
  readonly message?: string;
}

export interface RevocationPollState {
  readonly lastSeenRevocationAt: number;
  readonly revocations: readonly EntitlementRevocation[];
}

export interface EntitlementRevocationsResponse {
  readonly revocations: readonly EntitlementRevocation[];
  readonly serverTime?: number;
}

export type LifecycleEvent =
  | {
      readonly type: 'verified';
      readonly token: SignedEntitlementToken;
      readonly payload: EntitlementTokenPayload;
      readonly verifiedAt: number;
    }
  | {
      readonly type: 'refunded' | 'chargebacked';
      readonly jti: string;
      readonly revokedAt: number;
    }
  | {
      readonly type: 'manually-revoked';
      readonly jti: string;
      readonly revokedAt: number;
      readonly reason: string;
    }
  | {
      readonly type: 'plan-upgraded' | 'plan-downgraded';
      readonly oldFeatures: readonly ProFeature[];
      readonly newFeatures: readonly ProFeature[];
      readonly changedAt: number;
    }
  | {
      readonly type: 'expired';
      readonly expiredAt: number;
    };

export function mergeRevocationPollState(
  existing: RevocationPollState,
  incoming: readonly EntitlementRevocation[],
): RevocationPollState {
  const byJti = new Map<string, EntitlementRevocation>();
  for (const revocation of existing.revocations) {
    byJti.set(revocation.jti, revocation);
  }
  let lastSeenRevocationAt = existing.lastSeenRevocationAt;
  for (const revocation of incoming) {
    const previous = byJti.get(revocation.jti);
    if (previous == null || revocation.revokedAt >= previous.revokedAt) {
      byJti.set(revocation.jti, revocation);
    }
    lastSeenRevocationAt = Math.max(lastSeenRevocationAt, revocation.revokedAt);
  }
  return {
    lastSeenRevocationAt,
    revocations: Array.from(byJti.values()).sort((a, b) => a.revokedAt - b.revokedAt),
  };
}

export function findRevocationForPayload(
  payload: EntitlementTokenPayload,
  revocations: readonly EntitlementRevocation[],
): EntitlementRevocation | null {
  return revocations.find((revocation) => revocation.jti === payload.jti) ?? null;
}

export function applyRevocationsToEntitlement(
  state: EntitlementState,
  currentPayload: EntitlementTokenPayload,
  revocations: readonly EntitlementRevocation[],
): EntitlementState {
  const revocation = findRevocationForPayload(currentPayload, revocations);
  return revocation == null ? state : revokedState(state, revocation);
}

export function applyLifecycleEvent(
  state: EntitlementState,
  event: LifecycleEvent,
): EntitlementState {
  switch (event.type) {
    case 'verified':
      return stateFromVerifiedPayload(state, event.payload, event.verifiedAt);
    case 'refunded':
      return revokedState(state, {
        jti: event.jti,
        revokedAt: event.revokedAt,
        reason: 'refunded',
      });
    case 'chargebacked':
      return revokedState(state, {
        jti: event.jti,
        revokedAt: event.revokedAt,
        reason: 'chargebacked',
      });
    case 'manually-revoked':
      return revokedState(state, {
        jti: event.jti,
        revokedAt: event.revokedAt,
        reason: 'manual',
        message: event.reason,
      });
    case 'plan-upgraded':
    case 'plan-downgraded':
      return {
        ...state,
        tier: state.tier === 'free' ? 'paid' : state.tier,
        hasPro: event.newFeatures.length > 0,
        status: 'verified',
        statusDetail:
          state.statusDetail?.kind === 'verified'
            ? state.statusDetail
            : { kind: 'verified', lastVerifiedAt: event.changedAt },
        features: [...event.newFeatures],
      };
    case 'expired':
      return {
        ...state,
        tier: 'free',
        hasPro: false,
        status: 'verification_failed',
        statusDetail: { kind: 'expired', expiredAt: event.expiredAt },
        features: [],
      };
  }
}

function stateFromVerifiedPayload(
  state: EntitlementState,
  payload: EntitlementTokenPayload,
  verifiedAt: number,
): EntitlementState {
  const tier = payload.tier === 'tester' ? 'tester_permanent' : payload.tier;
  return {
    ...state,
    tier,
    hasPro: payload.tier !== 'free',
    status: payload.tier === 'tester' ? 'tester' : 'verified',
    statusDetail:
      payload.tier === 'tester'
        ? { kind: 'tester', testerSlug: payload.sub }
        : { kind: 'verified', lastVerifiedAt: verifiedAt, expiresAt: payload.exp },
    features: payload.features as readonly ProFeature[],
    code: payload.sub,
  };
}

function revokedState(state: EntitlementState, revocation: EntitlementRevocation): EntitlementState {
  return {
    ...state,
    tier: 'free',
    hasPro: false,
    status: 'revoked',
    statusDetail: {
      kind: 'revoked',
      revokedAt: revocation.revokedAt,
      reason: revocation.reason,
    },
    lastError: revocation.message,
    features: [],
  };
}
