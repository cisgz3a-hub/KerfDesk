import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createMaterialLibraryDeviceHint,
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
} from '../../io/material-library';
import {
  EMPTY_MATERIAL_LIBRARY_COLLECTION,
  reconcileActiveDocument,
} from './material-library-collection';
import {
  MATERIAL_LIBRARIES_STORAGE_KEY,
  MATERIAL_LIBRARY_STORAGE_KEY,
  migrateLegacyLibrary,
  persistCollection,
  persistMaterialLibrary,
  restoreCollection,
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

describe('material library collection persistence (ADR-093)', () => {
  it('round-trips a collection', () => {
    const storage = memoryStorage();
    const collection = reconcileActiveDocument(
      EMPTY_MATERIAL_LIBRARY_COLLECTION,
      libraryFixture(),
      42,
    );
    expect(persistCollection(storage, collection)).toBe(true);
    expect(restoreCollection(storage)).toEqual(collection);
  });

  it('returns null when nothing is stored', () => {
    expect(restoreCollection(memoryStorage())).toBeNull();
  });

  it('clears the collection slot and returns null on a corrupt envelope', () => {
    const storage = memoryStorage();
    storage.setItem(MATERIAL_LIBRARIES_STORAGE_KEY, '{not json');
    expect(restoreCollection(storage)).toBeNull();
    expect(storage.map.has(MATERIAL_LIBRARIES_STORAGE_KEY)).toBe(false);
  });

  it('reports failure instead of throwing when the collection write fails (quota)', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        /* not reached */
      },
    };
    expect(persistCollection(storage, EMPTY_MATERIAL_LIBRARY_COLLECTION)).toBe(false);
  });

  it('migrates the legacy single-library slot into the collection and removes it', () => {
    const storage = memoryStorage();
    persistMaterialLibrary(storage, libraryFixture(), false);

    const migrated = migrateLegacyLibrary(storage, 7);

    expect(migrated?.activeLibraryId).toBe(libraryFixture().libraryId);
    expect(storage.map.has(MATERIAL_LIBRARY_STORAGE_KEY)).toBe(false);
    expect(restoreCollection(storage)).toEqual(migrated);
  });

  it('migrates nothing when there is no legacy slot', () => {
    expect(migrateLegacyLibrary(memoryStorage(), 7)).toBeNull();
  });
});
