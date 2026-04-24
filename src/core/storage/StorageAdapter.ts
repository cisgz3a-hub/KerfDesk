/**
 * Abstraction over persistent key/value storage.
 * Async to accommodate filesystem and IndexedDB backends.
 */
export interface StorageAdapter {
  /** Read a value. Returns null if the key is absent. */
  get(key: string): Promise<string | null>;

  /**
   * Write a value. Overwrites if the key exists.
   * Atomic at the adapter boundary.
   */
  set(key: string, value: string): Promise<void>;

  /** Remove a value. No-op if the key is absent. */
  remove(key: string): Promise<void>;

  /** List keys, optionally filtered by prefix. Order is not guaranteed. */
  list(prefix?: string): Promise<string[]>;

  /** Clear all keys. Intended for tests. */
  clear(): Promise<void>;
}
