import { describe, expect, it, vi } from 'vitest';

import { AutosaveSessionLocks, autosaveSessionLockName } from './autosave-session-lock';

const SESSION_A = 'session-a';
const SESSION_B = 'session-b';

describe('AutosaveSessionLocks', () => {
  it('holds one exclusive session claim until its idempotent release', async () => {
    const manager = new TestLockManager();
    const locks = new AutosaveSessionLocks(manager.asLockManager());
    const first = await locks.claim(SESSION_A);

    expect(first.kind).toBe('owned');
    await expect(locks.claim(SESSION_A)).resolves.toEqual({ kind: 'contended' });
    if (first.kind !== 'owned') return;
    await first.guard.release();
    await first.guard.release();

    const next = await locks.claim(SESSION_A);
    expect(next.kind).toBe('owned');
    if (next.kind === 'owned') await next.guard.release();
  });

  it('allows different session identities to coexist', async () => {
    const locks = new AutosaveSessionLocks(new TestLockManager().asLockManager());
    const first = await locks.claim(SESSION_A);
    const second = await locks.claim(SESSION_B);

    expect(first.kind).toBe('owned');
    expect(second.kind).toBe('owned');
    if (first.kind === 'owned') await first.guard.release();
    if (second.kind === 'owned') await second.guard.release();
  });

  it('reconciles only while an abandoned session is held exclusively', async () => {
    const manager = new TestLockManager();
    const locks = new AutosaveSessionLocks(manager.asLockManager());
    const owner = await locks.claim(SESSION_A);
    const reconcile = vi.fn(async () => 'removed');

    await expect(locks.runIfAbandoned(SESSION_A, reconcile)).resolves.toEqual({ kind: 'live' });
    expect(reconcile).not.toHaveBeenCalled();
    if (owner.kind === 'owned') await owner.guard.release();

    await expect(locks.runIfAbandoned(SESSION_A, reconcile)).resolves.toEqual({
      kind: 'reconciled',
      value: 'removed',
    });
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it('keeps a session contended while its reconciliation callback runs', async () => {
    const locks = new AutosaveSessionLocks(new TestLockManager().asLockManager());
    let finish = (): void => undefined;
    const waiting = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const reconciliation = locks.runIfAbandoned(SESSION_A, async () => waiting);

    await vi.waitFor(async () => {
      await expect(locks.claim(SESSION_A)).resolves.toEqual({ kind: 'contended' });
    });
    finish();
    await expect(reconciliation).resolves.toMatchObject({ kind: 'reconciled' });
  });

  it('releases the probe lock when reconciliation fails', async () => {
    const locks = new AutosaveSessionLocks(new TestLockManager().asLockManager());
    const failure = new Error('cleanup failed');

    await expect(
      locks.runIfAbandoned(SESSION_A, async () => {
        throw failure;
      }),
    ).resolves.toEqual({ kind: 'failed', error: failure });

    const claim = await locks.claim(SESSION_A);
    expect(claim.kind).toBe('owned');
    if (claim.kind === 'owned') await claim.guard.release();
  });

  it('reports manager rejection without an unhandled failure', async () => {
    const failure = new Error('lock manager failed');
    const manager = {
      request: vi.fn(async () => {
        throw failure;
      }),
    } as unknown as LockManager;
    const locks = new AutosaveSessionLocks(manager);

    await expect(locks.claim(SESSION_A)).resolves.toEqual({ kind: 'failed', error: failure });
    await expect(locks.runIfAbandoned(SESSION_A, vi.fn())).resolves.toEqual({
      kind: 'failed',
      error: failure,
    });
  });

  it('retains data when Web Locks are unsupported', async () => {
    const reconcile = vi.fn(async () => undefined);
    const locks = new AutosaveSessionLocks(null);

    await expect(locks.claim(SESSION_A)).resolves.toEqual({ kind: 'unsupported' });
    await expect(locks.runIfAbandoned(SESSION_A, reconcile)).resolves.toEqual({
      kind: 'unsupported',
    });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('contains a throwing ambient Web Locks getter as unsupported', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      get: () => {
        throw new DOMException('Web Locks blocked', 'SecurityError');
      },
    });
    try {
      await expect(new AutosaveSessionLocks().claim(SESSION_A)).resolves.toEqual({
        kind: 'unsupported',
      });
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(navigator, 'locks');
      else Object.defineProperty(navigator, 'locks', descriptor);
    }
  });

  it('uses a dedicated autosave lock namespace', () => {
    expect(autosaveSessionLockName(SESSION_A)).toBe('curvedesk-project-autosave-session:session-a');
  });
});

class TestLockManager {
  private readonly heldNames = new Set<string>();

  asLockManager(): LockManager {
    return { request: this.request.bind(this) } as LockManager;
  }

  private async request<T>(
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => Promise<T> | T,
  ): Promise<T> {
    if (options.ifAvailable === true && this.heldNames.has(name)) return callback(null);
    this.heldNames.add(name);
    try {
      return await callback({ name, mode: 'exclusive' } as Lock);
    } finally {
      this.heldNames.delete(name);
    }
  }
}
