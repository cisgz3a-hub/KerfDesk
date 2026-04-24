export type { StorageAdapter } from './StorageAdapter';
export { InMemoryStorageAdapter } from './InMemoryStorageAdapter';
export { IndexedDbStorageAdapter } from './IndexedDbStorageAdapter';
export { FilesystemStorageAdapter } from './FilesystemStorageAdapter';
export type { StorageIpc } from './FilesystemStorageAdapter';
export { createDefaultStorage } from './bootstrap';
