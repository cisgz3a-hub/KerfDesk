// KerfDesk asks the browser to keep its local storage at most once per page
// session, and nothing the browser answers can reach the operator.

import { afterEach, describe, expect, it, vi } from 'vitest';

function installStorage(storage: object | undefined): void {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
}

// A fresh module per test: the once-per-session memory lives as long as the page.
async function freshRequest(): Promise<() => void> {
  vi.resetModules();
  return (await import('./persistent-storage-request')).requestPersistentStorageOnce;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'storage');
});

describe('requestPersistentStorageOnce', () => {
  it('asks once per page session while the storage is still best-effort', async () => {
    const storage = { persisted: vi.fn(async () => false), persist: vi.fn(async () => true) };
    installStorage(storage);
    const request = await freshRequest();

    request();
    request();
    await settle();
    request();
    await settle();

    expect(storage.persisted).toHaveBeenCalledTimes(1);
    expect(storage.persist).toHaveBeenCalledTimes(1);
  });

  it('does not ask when the browser already keeps the storage', async () => {
    const storage = { persisted: vi.fn(async () => true), persist: vi.fn(async () => true) };
    installStorage(storage);

    (await freshRequest())();
    await settle();

    expect(storage.persist).not.toHaveBeenCalled();
  });

  it('takes a denial quietly and does not ask again that session', async () => {
    const storage = { persisted: vi.fn(async () => false), persist: vi.fn(async () => false) };
    installStorage(storage);
    const request = await freshRequest();

    request();
    await settle();
    request();
    await settle();

    expect(storage.persist).toHaveBeenCalledTimes(1);
  });

  it('swallows every failure the browser can raise', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      installStorage({
        persisted: async () => false,
        persist: async () => Promise.reject(new DOMException('Denied', 'NotAllowedError')),
      });
      (await freshRequest())();
      installStorage({
        persisted: async () => Promise.reject(new Error('Storage is broken')),
        persist: async () => true,
      });
      (await freshRequest())();
      // A sandboxed frame can throw from the getter itself.
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        get: () => {
          throw new DOMException('Blocked', 'SecurityError');
        },
      });
      const request = await freshRequest();
      expect(() => request()).not.toThrow();
      await settle();

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('does nothing where the browser has no StorageManager', async () => {
    installStorage(undefined);
    const request = await freshRequest();
    expect(() => request()).not.toThrow();

    // A persist() without persisted() cannot tell whether asking is needed.
    const persist = vi.fn(async () => true);
    installStorage({ persist });
    (await freshRequest())();
    await settle();

    expect(persist).not.toHaveBeenCalled();
  });
});
