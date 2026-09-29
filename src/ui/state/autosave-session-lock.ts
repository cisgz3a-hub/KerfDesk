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
  // This page's probes of one session run one after another. A probe that met
  // this page's own probe would take it for a live window: StrictMode runs the
  // recovery read twice in development, and both probe the same session.
  private readonly probes = new Map<string, Promise<void>>();

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
    const manager = this.manager;
    if (manager === undefined) return { kind: 'unsupported' };
    const probe = (this.probes.get(sessionId) ?? Promise.resolve()).then(() =>
      probeSession(manager, sessionId, reconcile),
    );
    const settled = probe.then(
      () => undefined,
      () => undefined,
    );
    this.probes.set(sessionId, settled);
    try {
      return await probe;
    } finally {
      if (this.probes.get(sessionId) === settled) this.probes.delete(sessionId);
    }
  }
}

async function probeSession<T>(
  manager: LockManager,
  sessionId: string,
  reconcile: () => Promise<T>,
): Promise<AutosaveSessionProbe<T>> {
  try {
    return await manager.request(
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
