import { describe, expect, it, vi } from 'vitest';
import { IndexedDbRecoveryStorageBackend } from './indexeddb-recovery-backend';

describe('IndexedDbRecoveryStorageBackend', () => {
  it('aborts and rejects when a cursor visitor throws synchronously', async () => {
    const failure = new Error('Cursor delete failed synchronously.');
    const cursor = {
      key: 'discard-me',
      delete: vi.fn(() => {
        throw failure;
      }),
      continue: vi.fn(),
    };
    const cursorRequest: {
      result: typeof cursor;
      onsuccess?: () => void;
      onerror?: () => void;
      error?: DOMException | null;
    } = { result: cursor };
    const store = {
      openCursor: vi.fn(() => {
        queueMicrotask(() => cursorRequest.onsuccess?.());
        return cursorRequest;
      }),
    };
    const transaction = {
      objectStore: vi.fn(() => store),
      abort: vi.fn(),
    };
    const database = {
      transaction: vi.fn(() => transaction),
    };
    const openRequest: {
      result: typeof database;
      onsuccess?: () => void;
      onerror?: () => void;
      onblocked?: () => void;
      onupgradeneeded?: () => void;
      error?: DOMException | null;
    } = { result: database };
    const factory = {
      open: vi.fn(() => {
        queueMicrotask(() => openRequest.onsuccess?.());
        return openRequest;
      }),
    };
    const backend = new IndexedDbRecoveryStorageBackend(factory as unknown as IDBFactory);

    await expect(backend.deleteArtifactsExcept(new Set())).rejects.toBe(failure);
    expect(transaction.abort).toHaveBeenCalledOnce();
    expect(cursor.continue).not.toHaveBeenCalled();
  });
});
