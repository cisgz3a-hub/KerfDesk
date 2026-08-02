import { describe, expect, it, vi } from 'vitest';
import {
  MAX_PAGED_ASSET_STAGING_RECONCILIATIONS,
  reconcileStalePagedAssetStaging,
  type StalePagedAssetStaging,
} from './paged-asset-startup-staging-cleanup';

describe('reconcileStalePagedAssetStaging', () => {
  it('removes only expired staging whose owning realm lock is no longer live', async () => {
    const abandoned = staging('abandoned');
    const live = staging('live');
    const repository = {
      listStaleProtectedStaging: vi.fn(async () => [abandoned, live]),
      removeStaleProtectedStaging: vi.fn(async () => true),
    };
    const probe = {
      runIfAbandoned: vi.fn(async (assetId: string, reconcile: () => Promise<void>) => {
        if (assetId === live.assetId) return 'live' as const;
        await reconcile();
        return 'reconciled' as const;
      }),
    };

    await expect(
      reconcileStalePagedAssetStaging({ nowEpochMs: 10_000, maxAssets: 2 }, repository, probe),
    ).resolves.toEqual({
      examined: 2,
      removed: 1,
      retainedLive: 1,
      retainedUnsupported: 0,
    });
    expect(repository.removeStaleProtectedStaging).toHaveBeenCalledOnce();
    expect(repository.removeStaleProtectedStaging).toHaveBeenCalledWith(abandoned, 10_000);
  });

  it('retains every candidate when cross-realm abandonment proof is unavailable', async () => {
    const repository = {
      listStaleProtectedStaging: vi.fn(async () => [staging('unsupported')]),
      removeStaleProtectedStaging: vi.fn(async () => true),
    };

    await expect(
      reconcileStalePagedAssetStaging({ nowEpochMs: 10_000, maxAssets: 1 }, repository, {
        runIfAbandoned: vi.fn(async () => 'unsupported' as const),
      }),
    ).resolves.toMatchObject({ removed: 0, retainedUnsupported: 1 });
    expect(repository.removeStaleProtectedStaging).not.toHaveBeenCalled();
  });

  it('rejects work above the fixed startup bound', async () => {
    await expect(
      reconcileStalePagedAssetStaging(
        {
          nowEpochMs: 10_000,
          maxAssets: MAX_PAGED_ASSET_STAGING_RECONCILIATIONS + 1,
        },
        {
          listStaleProtectedStaging: vi.fn(async () => []),
          removeStaleProtectedStaging: vi.fn(async () => true),
        },
        { runIfAbandoned: vi.fn(async () => 'reconciled' as const) },
      ),
    ).rejects.toThrow('cannot exceed 64');
  });
});

function staging(name: string): StalePagedAssetStaging {
  return {
    schemaVersion: 1,
    assetId: `${name}-asset`,
    sourceName: `${name}.bin`,
    mimeType: 'application/octet-stream',
    byteLength: 4,
    writtenByteLength: 4,
    pageBytes: 4,
    pageCount: 1,
    createdAtEpochMs: 1,
    state: 'staging',
    stagingLockProtection: 'web-lock',
    stagingExpiresAtEpochMs: 5_000,
  };
}
