export type PagedAssetCrossRealmGuard = {
  release(): Promise<void>;
};

export type PagedAssetCrossRealmHolder = {
  hold(id: string): Promise<PagedAssetCrossRealmGuard | null>;
};

export type PagedAssetCrossRealmProbeResult = 'reconciled' | 'live' | 'unsupported';

export type PagedAssetCrossRealmProbe = {
  runIfAbandoned(
    id: string,
    reconcile: () => Promise<void>,
  ): Promise<PagedAssetCrossRealmProbeResult>;
};

export class PagedAssetCrossRealmLocks
  implements PagedAssetCrossRealmHolder, PagedAssetCrossRealmProbe
{
  constructor(
    private readonly namespace: string,
    private readonly manager: LockManager | undefined = globalThis.navigator?.locks,
  ) {}

  async hold(id: string): Promise<PagedAssetCrossRealmGuard | null> {
    if (this.manager === undefined) return null;
    let releaseHold = (): void => undefined;
    let resolveAcquired = (): void => undefined;
    let rejectAcquired = (_error: unknown): void => undefined;
    const held = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const acquired = new Promise<void>((resolve, reject) => {
      resolveAcquired = resolve;
      rejectAcquired = reject;
    });
    const completion = this.manager
      .request(this.lockName(id), { mode: 'shared' }, async () => {
        resolveAcquired();
        await held;
      })
      .catch((error: unknown) => {
        rejectAcquired(error);
        throw error;
      });
    try {
      await acquired;
    } catch (error) {
      await completion.catch(() => undefined);
      throw error;
    }
    let isReleased = false;
    return {
      release: async () => {
        if (isReleased) return;
        isReleased = true;
        releaseHold();
        await completion;
      },
    };
  }

  async runIfAbandoned(
    id: string,
    reconcile: () => Promise<void>,
  ): Promise<PagedAssetCrossRealmProbeResult> {
    if (this.manager === undefined) return 'unsupported';
    return this.manager.request(
      this.lockName(id),
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (lock === null) return 'live';
        await reconcile();
        return 'reconciled';
      },
    );
  }

  private lockName(id: string): string {
    return pagedAssetCrossRealmLockName(this.namespace, id);
  }
}

export function pagedAssetCrossRealmLockName(namespace: string, id: string): string {
  return `${namespace}:${id}`;
}
