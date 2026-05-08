import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { isStorageKeyAllowed, type StorageNamespace } from './storageNamespaces';

export interface StorageFsBackend {
  namespacedGet(namespace: StorageNamespace, key: string): string | null;
  namespacedSet(namespace: StorageNamespace, key: string, value: string): void;
  namespacedRemove(namespace: StorageNamespace, key: string): void;
  namespacedList(namespace: StorageNamespace, prefix?: string): string[];
  storageClear(): void;
}

function keyToFilename(key: string): string {
  return Buffer.from(key, 'utf8').toString('hex') + '.json';
}

function filenameToKey(filename: string): string {
  const base = filename.endsWith('.json') ? filename.slice(0, -5) : filename;
  return Buffer.from(base, 'hex').toString('utf8');
}

function ensureStorageDir(baseUserDataPath: string): string {
  const dir = path.join(baseUserDataPath, 'laserforge-storage');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function createStorageFsBackend(baseUserDataPath: string): StorageFsBackend {
  const getDir = (): string => ensureStorageDir(baseUserDataPath);

  function assertAllowed(namespace: StorageNamespace, key: string): void {
    if (!isStorageKeyAllowed(namespace, key)) {
      throw new Error(`Invalid storage key for ${namespace} namespace`);
    }
  }

  function readKey(key: string): string | null {
    const file = path.join(getDir(), keyToFilename(key));
    try {
      return fs.readFileSync(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  function writeKey(key: string, value: string): void {
    const dir = getDir();
    const file = path.join(dir, keyToFilename(key));
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, value, 'utf8');
    fs.renameSync(tmp, file);
  }

  function removeKey(key: string): void {
    const file = path.join(getDir(), keyToFilename(key));
    try {
      fs.unlinkSync(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  function listKeys(): string[] {
    const dir = getDir();
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return [];
    }
    return entries
      .filter(f => f.endsWith('.json'))
      .map(filenameToKey);
  }

  return {
    namespacedGet(namespace: StorageNamespace, key: string): string | null {
      assertAllowed(namespace, key);
      return readKey(key);
    },

    namespacedSet(namespace: StorageNamespace, key: string, value: string): void {
      assertAllowed(namespace, key);
      writeKey(key, value);
    },

    namespacedRemove(namespace: StorageNamespace, key: string): void {
      assertAllowed(namespace, key);
      removeKey(key);
    },

    namespacedList(namespace: StorageNamespace, prefix?: string): string[] {
      return listKeys().filter(key =>
        isStorageKeyAllowed(namespace, key)
        && (!prefix || key.startsWith(prefix)),
      );
    },

    storageClear(): void {
      const dir = getDir();
      let entries: string[];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        return;
      }
      for (const f of entries) {
        if (!f.endsWith('.json')) continue;
        try {
          fs.unlinkSync(path.join(dir, f));
        } catch {
          // ignore individual deletion failures during clear
        }
      }
    },
  };
}

const defaultBackend = (): StorageFsBackend => createStorageFsBackend(app.getPath('userData'));

export function namespacedStorageGet(namespace: StorageNamespace, key: string): string | null {
  return defaultBackend().namespacedGet(namespace, key);
}

export function namespacedStorageSet(namespace: StorageNamespace, key: string, value: string): void {
  defaultBackend().namespacedSet(namespace, key, value);
}

export function namespacedStorageRemove(namespace: StorageNamespace, key: string): void {
  defaultBackend().namespacedRemove(namespace, key);
}

export function namespacedStorageList(namespace: StorageNamespace, prefix?: string): string[] {
  return defaultBackend().namespacedList(namespace, prefix);
}

export function storageClear(): void {
  defaultBackend().storageClear();
}
