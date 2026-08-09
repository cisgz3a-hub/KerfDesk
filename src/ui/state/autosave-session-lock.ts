const AUTOSAVE_LOCK_NAMESPACE = 'curvedesk-project-autosave-session';

export type AutosaveSessionGuard = {
  release(): Promise<void>;
};

export type AutosaveSessionClaim =
  | { readonly kind: 'owned'; readonly guard: AutosaveSessionGuard }
  | { readonly kind: 'contended' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'failed'; readonly error: unknown };

export type AutosaveSessionProbe<T> =
  | { readonly kind: 'reconciled'; readonly value: T }
  | { readonly kind: 'live' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'failed'; readonly error: unknown };

export class AutosaveSessionLocks {
  private readonly manager: LockManager | undefined;

  constructor(manager: LockManager | null | undefined = availableLockManager()) {
    this.manager = manager ?? undefined;
  }

  async claim(sessionId: string): Promise<AutosaveSessionClaim> {
    const manager = this.manager;
    if (manager === undefined) return { kind: 'unsupported' };
    let releaseHold = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    let resolveClaim = (_claim: AutosaveSessionClaim): void => undefined;
    const claimed = new Promise<AutosaveSessionClaim>((resolve) => {
      resolveClaim = resolve;
    });
    const completion = Promise.resolve()
      .then(() =>
        manager.request(
          autosaveSessionLockName(sessionId),
          { mode: 'exclusive', ifAvailable: true },
          async (lock) => {
            if (lock === null) {
              resolveClaim({ kind: 'contended' });
              return;
            }
            resolveClaim({ kind: 'owned', guard: releaseGuard(releaseHold, () => completion) });
            await held;
          },
        ),
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        resolveClaim({ kind: 'failed', error });
      });
    return claimed;
  }

  async runIfAbandoned<T>(
    sessionId: string,
    reconcile: () => Promise<T>,
  ): Promise<AutosaveSessionProbe<T>> {
    if (this.manager === undefined) return { kind: 'unsupported' };
    try {
      return await this.manager.request(
        autosaveSessionLockName(sessionId),
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (lock === null) return { kind: 'live' } as const;
          return { kind: 'reconciled', value: await reconcile() } as const;
        },
      );
    } catch (error) {
      return { kind: 'failed', error };
    }
  }
}

function availableLockManager(): LockManager | undefined {
  try {
    return globalThis.navigator?.locks;
  } catch {
    return undefined;
  }
}

export function autosaveSessionLockName(sessionId: string): string {
  return `${AUTOSAVE_LOCK_NAMESPACE}:${sessionId}`;
}

function releaseGuard(
  releaseHold: () => void,
  completion: () => Promise<void>,
): AutosaveSessionGuard {
  let released = false;
  return {
    release: async () => {
      if (!released) {
        released = true;
        releaseHold();
      }
      await completion();
    },
  };
}
