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

// T1-78: entitlement API split into a boolean check (canUseFeature) and an
// enforcement guard (assertFeature). The previous single function returned
// a boolean despite its enforcement-sounding name — a naming hazard, since
// the next-naive caller might pair the call with the gated work and skip
// the gate entirely. Phase 1 added the new functions alongside a
// transitional alias; Phase 2 migrated all internal callers; Phase 3
// removed the alias.
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
