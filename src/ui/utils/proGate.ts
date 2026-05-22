import {
  canUse as entitlementCanUse,
  hasPro as entitlementHasPro,
  type ProFeature,
} from '../../entitlements';

export type { ProFeature } from '../../entitlements';

export function isProUnlocked(): boolean {
  return entitlementHasPro();
}

export function checkProAccess(feature: ProFeature): boolean {
  return entitlementCanUse(feature);
}

/**
 * Run the locked-action callback if the feature is locked.
 * Returns true if user has access, false if they don't.
 *
 * T1-followup-safety-gated-feature (2026-05-10): pre-fix this called
 * `isProUnlocked()` (the blanket pro state) and ignored the `feature`
 * argument entirely. That broke per-feature gating: a tiered or
 * partial-feature license that grants e.g. `nesting` but not
 * `boolean_ops` would either pass both gates (when hasPro=true) or
 * fail both (when hasPro=false), regardless of the actual feature
 * being requested. Net effect for product correctness: the underlying
 * `EntitlementService.canUse(feature)` already implemented per-feature
 * checks, but the UI gate ignored them. The fix routes through
 * `checkProAccess(feature)` which delegates to `entitlementCanUse`,
 * preserving the existing entitlement semantics for users with
 * blanket-pro licenses while making feature-scoped licenses work
 * correctly.
 */
export function gatedFeature(feature: ProFeature, onLockedAction?: () => void): boolean {
  if (checkProAccess(feature)) return true;
  if (onLockedAction) {
    onLockedAction();
  }
  return false;
}
