import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYER_DEFAULTS_STATE,
  type LayerDefaultsState,
} from '../state/layer-default-actions';
import {
  layerDefaultsStorageKey,
  persistLayerDefaults,
  restoreLayerDefaults,
} from './layer-default-settings';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function memoryStorage(): StorageLike & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function defaultsFixture(): LayerDefaultsState {
  return {
    byColor: { '#ff0000': { mode: 'fill', power: 42, speed: 1777 } },
    allColors: { mode: 'line', power: 30 },
  };
}

describe('layer default settings persistence', () => {
  it('round-trips defaults for the active device profile', () => {
    const storage = memoryStorage();

    expect(persistLayerDefaults(storage, 'GRBL4040', defaultsFixture())).toBe(true);

    expect(restoreLayerDefaults(storage, 'GRBL4040')).toEqual(defaultsFixture());
  });

  it('clears the slot when defaults are empty', () => {
    const storage = memoryStorage();
    persistLayerDefaults(storage, 'GRBL4040', defaultsFixture());

    expect(persistLayerDefaults(storage, 'GRBL4040', DEFAULT_LAYER_DEFAULTS_STATE)).toBe(true);

    expect(storage.map.has(layerDefaultsStorageKey('GRBL4040'))).toBe(false);
    expect(restoreLayerDefaults(storage, 'GRBL4040')).toBeNull();
  });

  it('does not restore defaults from a different device profile key', () => {
    const storage = memoryStorage();
    persistLayerDefaults(storage, 'Falcon', defaultsFixture());

    expect(restoreLayerDefaults(storage, 'GRBL4040')).toBeNull();
  });

  it('clears the slot and returns null on corrupt JSON', () => {
    const storage = memoryStorage();
    storage.setItem(layerDefaultsStorageKey('GRBL4040'), '{not json');

    expect(restoreLayerDefaults(storage, 'GRBL4040')).toBeNull();

    expect(storage.map.has(layerDefaultsStorageKey('GRBL4040'))).toBe(false);
  });

  it('reports failure instead of throwing when storage writes fail', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };

    expect(persistLayerDefaults(storage, 'GRBL4040', defaultsFixture())).toBe(false);
  });
});
