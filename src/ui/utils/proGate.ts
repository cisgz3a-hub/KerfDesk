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
 * Show a paywall prompt if the feature is locked.
 * Returns true if user has access, false if they don't.
 */
export function gatedFeature(feature: ProFeature, onLockedAction?: () => void): boolean {
  if (isProUnlocked()) return true;
  if (onLockedAction) {
    onLockedAction();
  } else {
    if (confirm('This is a PRO feature. Unlock LaserForge PRO for $30?\n\nClick OK to learn more.')) {
      window.open('/landing.html', '_blank');
    }
  }
  return false;
}
