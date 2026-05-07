import { FilesystemStorageAdapter } from './FilesystemStorageAdapter';
import { IndexedDbStorageAdapter } from './IndexedDbStorageAdapter';
import { InMemoryStorageAdapter } from './InMemoryStorageAdapter';
import { STORAGE_NAMESPACES } from './StorageNamespaces';
import type { StorageAdapter } from './StorageAdapter';

function isStorageIpc(api: unknown): api is {
  storage: Record<string, {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
    remove: (key: string) => Promise<void>;
    list: () => Promise<string[]>;
  }>;
  // T1-84: storageClear no longer required (or accepted) on the IPC
  // contract. The guard accepts shapes that don't expose bulk clear.
} {
  if (!api || typeof api !== 'object') return false;
  const typed = api as Record<string, unknown>;
  if (!typed.storage || typeof typed.storage !== 'object') return false;
  const storage = typed.storage as Record<string, unknown>;
  return STORAGE_NAMESPACES.every(namespace => {
    const scoped = storage[namespace] as Record<string, unknown> | undefined;
    return !!scoped
      && typeof scoped.get === 'function'
      && typeof scoped.set === 'function'
      && typeof scoped.remove === 'function'
      && typeof scoped.list === 'function';
  });
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
