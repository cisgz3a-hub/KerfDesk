import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SNAP_SETTINGS } from '../workspace/snap-settings';
import { readSnapSettings, SNAP_SETTINGS_KEY, writeSnapSettings } from './snap-preferences';
import { useUiStore } from './ui-store';

function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('snap preference storage', () => {
  it('round-trips the settings', () => {
    const storage = memoryStorage();
    const settings = { ...DEFAULT_SNAP_SETTINGS, snapToIntersections: false, gridMm: 5 };

    writeSnapSettings(settings, storage);

    expect(readSnapSettings(storage)).toEqual(settings);
  });

  it('reads defaults when nothing, or something unreadable, is stored', () => {
    expect(readSnapSettings(memoryStorage())).toEqual(DEFAULT_SNAP_SETTINGS);
    expect(readSnapSettings(memoryStorage({ [SNAP_SETTINGS_KEY]: '{not json' }))).toEqual(
      DEFAULT_SNAP_SETTINGS,
    );
    expect(readSnapSettings(null)).toEqual(DEFAULT_SNAP_SETTINGS);
  });

  it('survives a storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };

    expect(readSnapSettings(broken)).toEqual(DEFAULT_SNAP_SETTINGS);
    expect(() => writeSnapSettings(DEFAULT_SNAP_SETTINGS, broken)).not.toThrow();
  });
});

describe('ui store snap slice', () => {
  beforeEach(() => {
    window.localStorage.removeItem(SNAP_SETTINGS_KEY);
    useUiStore.setState({ snapSettings: DEFAULT_SNAP_SETTINGS, snapMarker: null });
  });

  afterEach(() => {
    window.localStorage.removeItem(SNAP_SETTINGS_KEY);
    useUiStore.setState({ snapSettings: DEFAULT_SNAP_SETTINGS, snapMarker: null });
  });

  it('merges, clamps and persists a settings change', () => {
    useUiStore.getState().setSnapSettings({ snapToMidpoints: false, distancePx: 500 });

    const settings = useUiStore.getState().snapSettings;
    expect(settings).toEqual({ ...DEFAULT_SNAP_SETTINGS, snapToMidpoints: false, distancePx: 50 });
    expect(JSON.parse(window.localStorage.getItem(SNAP_SETTINGS_KEY) ?? 'null')).toEqual(settings);
  });

  it('keeps the same settings object when nothing changes', () => {
    const before = useUiStore.getState().snapSettings;

    useUiStore.getState().setSnapSettings({ gridMm: DEFAULT_SNAP_SETTINGS.gridMm });

    expect(useUiStore.getState().snapSettings).toBe(before);
    expect(window.localStorage.getItem(SNAP_SETTINGS_KEY)).toBeNull();
  });

  it('keeps the marker object while the pointer stays on the same target', () => {
    const marker = { kind: 'node' as const, pointMm: { x: 1, y: 2 } };
    useUiStore.getState().setSnapMarker(marker);

    useUiStore.getState().setSnapMarker({ kind: 'node', pointMm: { x: 1, y: 2 } });
    expect(useUiStore.getState().snapMarker).toBe(marker);

    useUiStore.getState().setSnapMarker({ kind: 'midpoint', pointMm: { x: 1, y: 2 } });
    expect(useUiStore.getState().snapMarker?.kind).toBe('midpoint');
  });

  it('clears the marker when the tool changes', () => {
    useUiStore.getState().setSnapMarker({ kind: 'center', pointMm: { x: 0, y: 0 } });

    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'rect' });

    expect(useUiStore.getState().snapMarker).toBeNull();
  });
});
