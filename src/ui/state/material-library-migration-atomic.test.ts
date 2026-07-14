import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createMaterialLibraryDeviceHint,
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
} from '../../io/material-library';
import {
  MATERIAL_LIBRARIES_STORAGE_KEY,
  MATERIAL_LIBRARY_STORAGE_KEY,
  migrateLegacyLibrary,
  persistMaterialLibrary,
  restoreMaterialLibrary,
} from './material-library-persistence';

function libraryFixture(): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: 'migration-test',
    name: 'Migration Test',
    deviceHint: createMaterialLibraryDeviceHint(DEFAULT_DEVICE_PROFILE),
    entries: [],
  };
}

function seededStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & {
  readonly map: Map<string, string>;
} {
  const map = new Map<string, string>();
  const storage = {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
  expect(persistMaterialLibrary(storage, libraryFixture(), true)).toBe(true);
  return storage;
}

describe('atomic legacy material-library migration', () => {
  it('keeps the legacy library when the collection write fails', () => {
    const storage = seededStorage();
    const setItem = storage.setItem;
    storage.setItem = (key, value) => {
      if (key === MATERIAL_LIBRARIES_STORAGE_KEY) throw new Error('QuotaExceededError');
      setItem(key, value);
    };

    expect(migrateLegacyLibrary(storage, 7)).toBeNull();
    expect(storage.map.has(MATERIAL_LIBRARY_STORAGE_KEY)).toBe(true);
    expect(restoreMaterialLibrary(storage)?.library).toEqual(libraryFixture());
  });

  it('keeps the legacy library when collection readback does not match the write', () => {
    const storage = seededStorage();
    const setItem = storage.setItem;
    storage.setItem = (key, value) => {
      if (key !== MATERIAL_LIBRARIES_STORAGE_KEY) setItem(key, value);
    };

    expect(migrateLegacyLibrary(storage, 7)).toBeNull();
    expect(storage.map.has(MATERIAL_LIBRARY_STORAGE_KEY)).toBe(true);
    expect(restoreMaterialLibrary(storage)?.library).toEqual(libraryFixture());
  });
});
