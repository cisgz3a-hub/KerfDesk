import { describe, expect, it, vi } from 'vitest';
import {
  reconcileExpiredPagedAssetLeases,
  type ExpiredPagedAssetLease,
} from './paged-asset-startup-reconciliation';

describe('reconcileExpiredPagedAssetLeases', () => {
  it('removes only expired leases whose owning realm lock is no longer live', async () => {
    const abandoned = lease('abandoned');
    const live = lease('live');
    const repository = {
      listExpiredLeases: vi.fn(async () => [abandoned, live]),
      removeExpiredLease: vi.fn(async () => true),
    };
    const probe = {
      runIfAbandoned: vi.fn(async (leaseId: string, reconcile: () => Promise<void>) => {
        if (leaseId === live.leaseId) return 'live' as const;
        await reconcile();
        return 'reconciled' as const;
      }),
    };

    await expect(
      reconcileExpiredPagedAssetLeases({ nowEpochMs: 10_000, maxLeases: 2 }, repository, probe),
    ).resolves.toEqual({
      examined: 2,
      removed: 1,
      retainedLive: 1,
      retainedUnsupported: 0,
    });
    expect(repository.removeExpiredLease).toHaveBeenCalledOnce();
    expect(repository.removeExpiredLease).toHaveBeenCalledWith(abandoned, 10_000);
  });

  it('retains every candidate when cross-realm lock proof is unavailable', async () => {
    const repository = {
      listExpiredLeases: vi.fn(async () => [lease('legacy-browser')]),
      removeExpiredLease: vi.fn(async () => true),
    };
    const probe = {
      runIfAbandoned: vi.fn(async () => 'unsupported' as const),
    };

    await expect(
      reconcileExpiredPagedAssetLeases({ nowEpochMs: 10_000, maxLeases: 1 }, repository, probe),
    ).resolves.toMatchObject({ removed: 0, retainedUnsupported: 1 });
    expect(repository.removeExpiredLease).not.toHaveBeenCalled();
  });

  it('rejects a batch above the fixed startup bound', async () => {
    await expect(
      reconcileExpiredPagedAssetLeases(
        { nowEpochMs: 10_000, maxLeases: 65 },
        {
          listExpiredLeases: vi.fn(async () => []),
          removeExpiredLease: vi.fn(async () => true),
        },
        { runIfAbandoned: vi.fn(async () => 'reconciled' as const) },
      ),
    ).rejects.toThrow('cannot exceed 64');
  });
});

function lease(name: string): ExpiredPagedAssetLease {
  return {
    assetId: `${name}-asset`,
    leaseId: `${name}-lease`,
    expiresAtEpochMs: 5_000,
    lockProtection: 'web-lock',
  };
}
