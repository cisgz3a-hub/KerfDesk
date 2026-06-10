import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createMaterialLibraryDeviceHint,
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
} from '../../io/material-library';
import {
  MATERIAL_LIBRARY_STORAGE_KEY,
  persistMaterialLibrary,
  restoreMaterialLibrary,
} from './material-library-persistence';

function libraryFixture(): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: 'laserforge-test',
    name: 'Test Library',
    deviceHint: createMaterialLibraryDeviceHint(DEFAULT_DEVICE_PROFILE),
    entries: [],
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function memoryStorage(): StorageLike & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('material library persistence', () => {
  it('round-trips a clean library', () => {
    const storage = memoryStorage();
    expect(persistMaterialLibrary(storage, libraryFixture(), false)).toBe(true);
    const restored = restoreMaterialLibrary(storage);
    expect(restored).not.toBeNull();
    expect(restored?.library).toEqual(libraryFixture());
    expect(restored?.dirty).toBe(false);
  });

  it('round-trips the dirty flag so an unsaved-to-file library stays marked', () => {
    const storage = memoryStorage();
    persistMaterialLibrary(storage, libraryFixture(), true);
    expect(restoreMaterialLibrary(storage)?.dirty).toBe(true);
  });

  it('persisting null clears the slot (Unload forgets the library)', () => {
    const storage = memoryStorage();
    persistMaterialLibrary(storage, libraryFixture(), false);
    expect(persistMaterialLibrary(storage, null, false)).toBe(true);
    expect(storage.map.has(MATERIAL_LIBRARY_STORAGE_KEY)).toBe(false);
    expect(restoreMaterialLibrary(storage)).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(restoreMaterialLibrary(memoryStorage())).toBeNull();
  });

  it('clears the slot and returns null on corrupt JSON', () => {
    const storage = memoryStorage();
    storage.setItem(MATERIAL_LIBRARY_STORAGE_KEY, '{not json');
    expect(restoreMaterialLibrary(storage)).toBeNull();
    expect(storage.map.has(MATERIAL_LIBRARY_STORAGE_KEY)).toBe(false);
  });

  it('clears the slot and returns null when the payload fails library validation', () => {
    const storage = memoryStorage();
    storage.setItem(
      MATERIAL_LIBRARY_STORAGE_KEY,
      JSON.stringify({ dirty: false, payload: '{"format":"not-a-library"}' }),
    );
    expect(restoreMaterialLibrary(storage)).toBeNull();
    expect(storage.map.has(MATERIAL_LIBRARY_STORAGE_KEY)).toBe(false);
  });

  it('reports failure instead of throwing when storage writes fail (quota)', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        /* not reached in this test */
      },
    };
    expect(persistMaterialLibrary(storage, libraryFixture(), false)).toBe(false);
  });
});
