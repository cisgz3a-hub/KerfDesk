import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface StorageFsBackend {
  storageGet(key: string): string | null;
  storageSet(key: string, value: string): void;
  storageRemove(key: string): void;
  storageList(prefix?: string): string[];
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

  return {
    storageGet(key: string): string | null {
      const file = path.join(getDir(), keyToFilename(key));
      try {
        return fs.readFileSync(file, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },

    storageSet(key: string, value: string): void {
      const dir = getDir();
      const file = path.join(dir, keyToFilename(key));
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, value, 'utf8');
      fs.renameSync(tmp, file);
    },

    storageRemove(key: string): void {
      const file = path.join(getDir(), keyToFilename(key));
      try {
        fs.unlinkSync(file);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    },

    storageList(prefix?: string): string[] {
      const dir = getDir();
      let entries: string[];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        return [];
      }
      const keys = entries
        .filter(f => f.endsWith('.json'))
        .map(filenameToKey);
      return prefix ? keys.filter(k => k.startsWith(prefix)) : keys;
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

export function storageGet(key: string): string | null {
  return defaultBackend().storageGet(key);
}

export function storageSet(key: string, value: string): void {
  defaultBackend().storageSet(key, value);
}

export function storageRemove(key: string): void {
  defaultBackend().storageRemove(key);
}

export function storageList(prefix?: string): string[] {
  return defaultBackend().storageList(prefix);
}

export function storageClear(): void {
  defaultBackend().storageClear();
}
