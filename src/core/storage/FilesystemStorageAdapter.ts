import type { StorageAdapter } from './StorageAdapter';
import { STORAGE_NAMESPACES, routeStorageKey, type StorageNamespace } from './StorageNamespaces';

export interface StorageNamespaceIpc {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface StorageIpc {
  storage: Record<StorageNamespace, StorageNamespaceIpc>;
  // T1-84: storageClear removed from the IPC contract. Bulk clear of the
  // Electron filesystem store was a single point of catastrophic data loss
  // (wiped license + profiles + presets + autosave + jobs in one call).
  // No renderer caller exists. If targeted clearing is ever needed, add a
  // scoped IPC handler with an explicit allow-list of key prefixes.
}

export class FilesystemStorageAdapter implements StorageAdapter {
  constructor(private readonly ipc: StorageIpc) {}

  get(key: string): Promise<string | null> {
    return this.scopeForKey(key).get(key);
  }

  set(key: string, value: string): Promise<void> {
    return this.scopeForKey(key).set(key, value);
  }

  remove(key: string): Promise<void> {
    return this.scopeForKey(key).remove(key);
  }

  async list(prefix?: string): Promise<string[]> {
    if (prefix) {
      const keys = await this.scopeForKey(prefix).list();
      return keys.filter(key => key.startsWith(prefix));
    }
    const keysByNamespace = await Promise.all(
      STORAGE_NAMESPACES.map(namespace => this.ipc.storage[namespace].list()),
    );
    return keysByNamespace.flat();
  }

  /**
   * T1-84: bulk clear is not supported on the Electron filesystem store.
   * The StorageAdapter interface keeps `clear()` because in-memory and
   * IndexedDB adapters use it for tests, but the filesystem variant
   * deliberately rejects so any future caller hitting Electron storage
   * sees an immediate error pointing at the right pattern (targeted
   * remove() calls or a future scoped IPC).
   */
  clear(): Promise<void> {
    return Promise.reject(new Error(
      'T1-84: bulk storage clear is not supported on Electron filesystem '
      + 'storage. Use targeted remove() calls or add a scoped IPC handler.',
    ));
  }

  private scopeForKey(key: string): StorageNamespaceIpc {
    return this.ipc.storage[routeStorageKey(key)];
  }
}
