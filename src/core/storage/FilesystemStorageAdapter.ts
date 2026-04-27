import type { StorageAdapter } from './StorageAdapter';

export interface StorageIpc {
  storageGet(key: string): Promise<string | null>;
  storageSet(key: string, value: string): Promise<void>;
  storageRemove(key: string): Promise<void>;
  storageList(prefix?: string): Promise<string[]>;
  // T1-84: storageClear removed from the IPC contract. Bulk clear of the
  // Electron filesystem store was a single point of catastrophic data loss
  // (wiped license + profiles + presets + autosave + jobs in one call).
  // No renderer caller exists. If targeted clearing is ever needed, add a
  // scoped IPC handler with an explicit allow-list of key prefixes.
}

export class FilesystemStorageAdapter implements StorageAdapter {
  constructor(private readonly ipc: StorageIpc) {}

  get(key: string): Promise<string | null> {
    return this.ipc.storageGet(key);
  }

  set(key: string, value: string): Promise<void> {
    return this.ipc.storageSet(key, value);
  }

  remove(key: string): Promise<void> {
    return this.ipc.storageRemove(key);
  }

  list(prefix?: string): Promise<string[]> {
    return this.ipc.storageList(prefix);
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
}
