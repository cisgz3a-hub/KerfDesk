export const PAGED_ASSET_DATABASE_NAME = 'curvedesk-import-assets-v1';
export const PAGED_ASSET_DATABASE_VERSION = 5;
export const PAGED_ASSET_MANIFEST_STORE = 'manifests';
export const PAGED_ASSET_PAGE_STORE = 'pages';
export const PAGED_ASSET_LEASE_STORE = 'leases';
export const PAGED_ASSET_DELETION_STORE = 'deletions';
export const PAGED_ASSET_LEASE_EXPIRY_INDEX = 'by-lock-protected-expiry';
export const PAGED_ASSET_STAGING_EXPIRY_INDEX = 'by-protected-staging-expiry';

export function upgradePagedAssetDatabase(
  database: IDBDatabase,
  transaction: IDBTransaction | null,
): void {
  const manifests = database.objectStoreNames.contains(PAGED_ASSET_MANIFEST_STORE)
    ? requireUpgradeTransaction(transaction).objectStore(PAGED_ASSET_MANIFEST_STORE)
    : database.createObjectStore(PAGED_ASSET_MANIFEST_STORE, { keyPath: 'assetId' });
  if (!manifests.indexNames.contains(PAGED_ASSET_STAGING_EXPIRY_INDEX)) {
    manifests.createIndex(PAGED_ASSET_STAGING_EXPIRY_INDEX, [
      'state',
      'stagingLockProtection',
      'stagingExpiresAtEpochMs',
    ]);
  }
  if (!database.objectStoreNames.contains(PAGED_ASSET_PAGE_STORE)) {
    database.createObjectStore(PAGED_ASSET_PAGE_STORE, { keyPath: ['assetId', 'index'] });
  }
  const leases = database.objectStoreNames.contains(PAGED_ASSET_LEASE_STORE)
    ? requireUpgradeTransaction(transaction).objectStore(PAGED_ASSET_LEASE_STORE)
    : database.createObjectStore(PAGED_ASSET_LEASE_STORE, {
        keyPath: ['assetId', 'leaseId'],
      });
  if (!leases.indexNames.contains(PAGED_ASSET_LEASE_EXPIRY_INDEX)) {
    leases.createIndex(PAGED_ASSET_LEASE_EXPIRY_INDEX, ['lockProtection', 'expiresAtEpochMs']);
  }
  if (!database.objectStoreNames.contains(PAGED_ASSET_DELETION_STORE)) {
    database.createObjectStore(PAGED_ASSET_DELETION_STORE, { keyPath: 'assetId' });
  }
}

function requireUpgradeTransaction(transaction: IDBTransaction | null): IDBTransaction {
  if (transaction === null)
    throw new Error('Page-asset schema upgrade transaction is unavailable.');
  return transaction;
}
