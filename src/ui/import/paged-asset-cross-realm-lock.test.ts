import { describe, expect, it, vi } from 'vitest';
import {
  PagedAssetCrossRealmLocks,
  pagedAssetCrossRealmLockName,
} from './paged-asset-cross-realm-lock';

describe('PagedAssetCrossRealmLocks', () => {
  it('holds a shared lock until release and reconciles only after it is abandoned', async () => {
    const manager = new TestLockManager();
    const locks = new PagedAssetCrossRealmLocks('curvedesk-test-assets', manager.asLockManager());
    const guard = await locks.hold('asset-a');
    const reconcile = vi.fn(async () => undefined);

    await expect(locks.runIfAbandoned('asset-a', reconcile)).resolves.toBe('live');
    expect(reconcile).not.toHaveBeenCalled();
    await guard?.release();
    await expect(locks.runIfAbandoned('asset-a', reconcile)).resolves.toBe('reconciled');
    expect(reconcile).toHaveBeenCalledOnce();
    expect(manager.requestedNames).toEqual([
      'curvedesk-test-assets:asset-a',
      'curvedesk-test-assets:asset-a',
      'curvedesk-test-assets:asset-a',
    ]);
  });

  it('retains data when Web Locks are unsupported', async () => {
    const locks = new PagedAssetCrossRealmLocks('curvedesk-test-assets', undefined);

    await expect(locks.hold('asset-a')).resolves.toBeNull();
    await expect(locks.runIfAbandoned('asset-a', vi.fn())).resolves.toBe('unsupported');
  });

  it('builds distinct names for each ownership domain', () => {
    expect(pagedAssetCrossRealmLockName('curvedesk-page-asset-lease', 'same-id')).toBe(
      'curvedesk-page-asset-lease:same-id',
    );
    expect(pagedAssetCrossRealmLockName('curvedesk-page-asset-staging', 'same-id')).toBe(
      'curvedesk-page-asset-staging:same-id',
    );
  });
});

class TestLockManager {
  readonly requestedNames: string[] = [];
  private readonly sharedNames = new Set<string>();

  asLockManager(): LockManager {
    return { request: this.request.bind(this) } as LockManager;
  }

  private async request<T>(
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => Promise<T> | T,
  ): Promise<T> {
    this.requestedNames.push(name);
    if (options.mode === 'shared') {
      this.sharedNames.add(name);
      try {
        return await callback({ name, mode: 'shared' } as Lock);
      } finally {
        this.sharedNames.delete(name);
      }
    }
    if (options.ifAvailable === true && this.sharedNames.has(name)) return callback(null);
    return callback({ name, mode: 'exclusive' } as Lock);
  }
}
