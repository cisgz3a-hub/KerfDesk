export type { EntitlementState, EntitlementTier, ProFeature, StoredLicenseCacheEntry } from './types';
export { PRO_FEATURES } from './types';
export {
  entitlementService,
  EntitlementService,
  tierDisplayName,
  type ActivateResult,
} from './EntitlementService';

import type { ProFeature } from './types';
import { entitlementService } from './EntitlementService';

export function hasPro(): boolean {
  return entitlementService.hasPro();
}

export function canUse(feature: ProFeature): boolean {
  return entitlementService.canUse(feature);
}

// T1-78: split entitlement API into a boolean check (canUseFeature) and an
// enforcement guard (assertFeature). The previous `requireFeature` name read
// as enforcement but only returned a boolean — a naming hazard since the
// next-naive caller might write `requireFeature(x); doProThing();` and skip
// the gate. The explicit split removes the foot-gun. `requireFeature` stays
// as a deprecated alias so existing callers keep working until they migrate.
export function canUseFeature(feature: ProFeature): boolean {
  return entitlementService.canUse(feature);
}

export class EntitlementError extends Error {
  constructor(public readonly feature: ProFeature, message?: string) {
    super(message ?? `Feature "${feature}" requires a Pro license`);
    this.name = 'EntitlementError';
  }
}

export function assertFeature(feature: ProFeature): void {
  if (!entitlementService.canUse(feature)) {
    throw new EntitlementError(feature);
  }
}

/** @deprecated T1-78: use `canUseFeature()` for boolean checks or `assertFeature()` for enforcement. */
export function requireFeature(feature: ProFeature): boolean {
  return entitlementService.canUse(feature);
}
