import { FilesystemStorageAdapter } from './FilesystemStorageAdapter';
import { IndexedDbStorageAdapter } from './IndexedDbStorageAdapter';
import { InMemoryStorageAdapter } from './InMemoryStorageAdapter';
import type { StorageAdapter } from './StorageAdapter';

function isStorageIpc(api: unknown): api is {
  storageGet: (key: string) => Promise<string | null>;
  storageSet: (key: string, value: string) => Promise<void>;
  storageRemove: (key: string) => Promise<void>;
  storageList: (prefix?: string) => Promise<string[]>;
  // T1-84: storageClear no longer required (or accepted) on the IPC
  // contract. The guard accepts shapes that don't expose bulk clear.
} {
  if (!api || typeof api !== 'object') return false;
  const typed = api as Record<string, unknown>;
  return typeof typed.storageGet === 'function'
    && typeof typed.storageSet === 'function'
    && typeof typed.storageRemove === 'function'
    && typeof typed.storageList === 'function';
}

/** Picks the right storage adapter for the current runtime. */
export function createDefaultStorage(): StorageAdapter {
  if (typeof window !== 'undefined') {
    const maybeApi = (window as unknown as { electronAPI?: unknown }).electronAPI;
    if (isStorageIpc(maybeApi)) {
      return new FilesystemStorageAdapter(maybeApi);
    }
    if (typeof indexedDB !== 'undefined') {
      return new IndexedDbStorageAdapter();
    }
  }
  return new InMemoryStorageAdapter();
}
