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
