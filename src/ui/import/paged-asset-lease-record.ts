export const DEFAULT_PAGED_ASSET_LEASE_TTL_MS = 24 * 60 * 60 * 1_000;

export type PagedAssetLeaseRecord = {
  readonly assetId: string;
  readonly leaseId: string;
  readonly expiresAtEpochMs: number;
  readonly lockProtection: 'web-lock' | 'none';
};
