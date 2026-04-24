import type { StorageAdapter } from './StorageAdapter';

export interface StorageIpc {
  storageGet(key: string): Promise<string | null>;
  storageSet(key: string, value: string): Promise<void>;
  storageRemove(key: string): Promise<void>;
  storageList(prefix?: string): Promise<string[]>;
  storageClear(): Promise<void>;
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

  clear(): Promise<void> {
    return this.ipc.storageClear();
  }
}
