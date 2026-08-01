import {
  PagedAssetCrossRealmLocks,
  pagedAssetCrossRealmLockName,
  type PagedAssetCrossRealmGuard,
  type PagedAssetCrossRealmHolder,
  type PagedAssetCrossRealmProbe,
  type PagedAssetCrossRealmProbeResult,
} from './paged-asset-cross-realm-lock';

const PAGED_ASSET_LEASE_LOCK_NAMESPACE = 'curvedesk-page-asset-lease';

export type PagedAssetLeaseGuard = PagedAssetCrossRealmGuard;
export type PagedAssetLeaseHolder = PagedAssetCrossRealmHolder;
export type PagedAssetLeaseProbeResult = PagedAssetCrossRealmProbeResult;
export type PagedAssetLeaseProbe = PagedAssetCrossRealmProbe;

export class PagedAssetLeaseLocks extends PagedAssetCrossRealmLocks {
  constructor(manager: LockManager | undefined = globalThis.navigator?.locks) {
    super(PAGED_ASSET_LEASE_LOCK_NAMESPACE, manager);
  }
}

export function pagedAssetLeaseLockName(leaseId: string): string {
  return pagedAssetCrossRealmLockName(PAGED_ASSET_LEASE_LOCK_NAMESPACE, leaseId);
}
