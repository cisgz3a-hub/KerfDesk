import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createLayerSubLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  captureLayerOperationSettings,
} from '../../core/scene';
import {
  DEFAULT_LAYER_DEFAULTS_STATE,
  type LayerDefaultsState,
} from '../state/layer-default-actions';
import {
  layerDefaultsStorageKey,
  captureLayerDefaultSettings,
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

  it.each([
    { power: 'full' },
    { power: 101 },
    { minPower: -1 },
    { mode: 'bogus' },
    { speed: -500 },
    { passes: 0 },
    { passes: 1.5 },
    { hatchSpacingMm: -1 },
    { fillOverscanMm: -1 },
    { fillBidirectional: 'false' },
    { fillStyle: 'bogus' },
    { output: 'false' },
    { name: 123 },
    { tabSizeMm: 0 },
    { ditherAlgorithm: 'bogus' },
    { linesPerMm: 0 },
    { subLayers: [{ id: 'sub-1', label: 'Broken', enabled: true, settings: { power: 25 } }] },
    { materialBinding: { libraryId: 'lib', presetId: 'preset', lastResolved: { power: 25 } } },
    { cnc: null },
    { cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 0 } },
    { cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'bogus' } },
    { cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, tabsEnabled: 'false' } },
    { cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, profileLead: { shape: 'arc', radiusMm: -1 } } },
    {
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        helixEntry: { minDiameterMm: 5, maxDiameterMm: 2, angleDeg: 3 },
      },
    },
  ])('rejects and clears semantically invalid persisted defaults: %j', (settings) => {
    const storage = memoryStorage();
    const key = layerDefaultsStorageKey('GRBL4040');
    storage.setItem(key, JSON.stringify({ byColor: {}, allColors: settings }));

    expect(restoreLayerDefaults(storage, 'GRBL4040')).toBeNull();
    expect(storage.map.has(key)).toBe(false);
  });

  it('rejects non-finite JSON numbers in per-color defaults', () => {
    const storage = memoryStorage();
    const key = layerDefaultsStorageKey('GRBL4040');
    storage.setItem(key, '{"byColor":{"#ff0000":{"speed":1e999}},"allColors":null}');

    expect(restoreLayerDefaults(storage, 'GRBL4040')).toBeNull();
    expect(storage.map.has(key)).toBe(false);
  });

  it('preserves valid imported values outside compact editor ranges and nested artwork settings', () => {
    const storage = memoryStorage();
    const layer = {
      ...createLayer({ id: 'source', color: '#ff0000' }),
      speed: 7,
      passes: 777,
      hatchAngleDeg: 450,
      hatchSpacingMm: 0.025,
      fillOverscanMm: 26.75,
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        feedMmPerMin: 7,
        spindleRpm: 77777,
        rampEntryDeg: 0.01,
        profileLead: { shape: 'arc' as const, radiusMm: 0.01, sweepDeg: 450 },
      },
    };
    const settings = captureLayerDefaultSettings({
      ...layer,
      subLayers: [createLayerSubLayer(layer, { id: 'sub-1', label: 'Finishing pass' })],
      materialBinding: {
        libraryId: 'lib',
        presetId: 'preset',
        lastResolved: captureLayerOperationSettings(layer),
      },
    });
    const defaults = {
      byColor: { '#ff0000': settings },
      allColors: { power: 0, fillOverscanMm: 0 },
    };

    persistLayerDefaults(storage, 'GRBL4040', defaults);

    expect(restoreLayerDefaults(storage, 'GRBL4040')).toEqual(defaults);
  });
});
