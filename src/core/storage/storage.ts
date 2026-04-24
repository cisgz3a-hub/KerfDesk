import type { StorageAdapter } from './StorageAdapter';
import { createDefaultStorage } from './bootstrap';

/** Global storage singleton selected for the current runtime. */
export const storage: StorageAdapter = createDefaultStorage();

let storageOverride: StorageAdapter | null = null;

/** Returns the active storage adapter (or test override when set). */
export function getStorage(): StorageAdapter {
  return storageOverride ?? storage;
}

/** Test-only adapter override hook. */
export function setStorageForTest(adapter: StorageAdapter | null): void {
  storageOverride = adapter;
}
