import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_LAYER_SETTINGS, DEFAULT_CNC_TOOLS } from '../../core/scene';
import { feedPresetPatch } from './cnc-library-actions';
import {
  CNC_LIBRARY_STORAGE_KEY,
  parseCncLibrary,
  persistCncLibrary,
  restoreCncLibrary,
} from './cnc-library-persistence';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  resetStore();
  useStore.setState({ cncLibrary: { customTools: [], feedPresets: [], machineProfiles: [] } });
});

describe('custom bits (F-CNC11)', () => {
  it('adding a bit stores it in the library AND the open CNC machine', () => {
    useStore.getState().setMachineKind('cnc');

    useStore.getState().addCustomCncTool({ name: '2 mm downcut', kind: 'end-mill', diameterMm: 2 });

    const state = useStore.getState();
    expect(state.cncLibrary.customTools).toHaveLength(1);
    const machine = state.project.machine;
    if (machine?.kind !== 'cnc') throw new Error('cnc machine missing');
    expect(machine.tools.some((tool) => tool.name === '2 mm downcut')).toBe(true);
  });

  it('library bits merge into the tool list when toggling into CNC mode', () => {
    useStore
      .getState()
      .addCustomCncTool({ name: 'Custom V', kind: 'v-bit', diameterMm: 6, tipAngleDeg: 90 });
    useStore.getState().setMachineKind('cnc');

    const machine = useStore.getState().project.machine;
    if (machine?.kind !== 'cnc') throw new Error('cnc machine missing');
    expect(machine.tools).toHaveLength(DEFAULT_CNC_TOOLS.length + 1);
    expect(machine.tools.some((tool) => tool.name === 'Custom V')).toBe(true);
  });

  it('deleting a custom bit removes it from the library and the machine', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().addCustomCncTool({ name: 'Temp', kind: 'end-mill', diameterMm: 4 });
    const id = useStore.getState().cncLibrary.customTools[0]?.id;
    if (id === undefined) throw new Error('custom tool missing');

    useStore.getState().deleteCustomCncTool(id);

    const state = useStore.getState();
    expect(state.cncLibrary.customTools).toHaveLength(0);
    const machine = state.project.machine;
    if (machine?.kind !== 'cnc') throw new Error('cnc machine missing');
    expect(machine.tools.some((tool) => tool.id === id)).toBe(false);
  });
});

describe('feed presets (F-CNC12)', () => {
  it('saves a preset from layer settings and applies as a layer patch', () => {
    useStore
      .getState()
      .saveCncFeedPreset('Ply rough', { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 1234 });

    const preset = useStore.getState().cncLibrary.feedPresets[0];
    if (preset === undefined) throw new Error('preset missing');
    expect(preset.name).toBe('Ply rough');
    expect(preset.feedMmPerMin).toBe(1234);
    expect(feedPresetPatch(preset)).toEqual({
      feedMmPerMin: 1234,
      plungeMmPerMin: DEFAULT_CNC_LAYER_SETTINGS.plungeMmPerMin,
      spindleRpm: DEFAULT_CNC_LAYER_SETTINGS.spindleRpm,
      depthPerPassMm: DEFAULT_CNC_LAYER_SETTINGS.depthPerPassMm,
      stepoverPercent: DEFAULT_CNC_LAYER_SETTINGS.stepoverPercent,
    });
  });
});

describe('machine profiles (F-CNC13)', () => {
  it('saves the current CNC setup and re-applies it undoably', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().updateCncMachine({ stock: { thicknessMm: 18 } });
    useStore.getState().saveCncMachineProfile('18mm ply sheet');
    useStore.getState().updateCncMachine({ stock: { thicknessMm: 3 } });

    const profile = useStore.getState().cncLibrary.machineProfiles[0];
    if (profile === undefined) throw new Error('profile missing');
    useStore.getState().applyCncMachineProfile(profile.id);

    const machine = useStore.getState().project.machine;
    if (machine?.kind !== 'cnc') throw new Error('cnc machine missing');
    expect(machine.stock.thicknessMm).toBe(18);

    useStore.getState().undo();
    const reverted = useStore.getState().project.machine;
    if (reverted?.kind !== 'cnc') throw new Error('cnc machine missing');
    expect(reverted.stock.thicknessMm).toBe(3);
  });
});

describe('persistence codec', () => {
  function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
    const slots = new Map<string, string>();
    return {
      getItem: (key) => slots.get(key) ?? null,
      setItem: (key, value) => void slots.set(key, value),
      removeItem: (key) => void slots.delete(key),
    };
  }

  it('round-trips the library through storage', () => {
    const storage = memoryStorage();
    useStore.getState().addCustomCncTool({ name: 'RT', kind: 'ball-nose', diameterMm: 3 });
    useStore.getState().saveCncFeedPreset('RT preset', DEFAULT_CNC_LAYER_SETTINGS);
    const library = useStore.getState().cncLibrary;

    expect(persistCncLibrary(storage, library)).toBe(true);
    expect(restoreCncLibrary(storage)).toEqual(library);
  });

  it('clears a corrupt slot and drops malformed entries field-safely', () => {
    const storage = memoryStorage();
    storage.setItem(CNC_LIBRARY_STORAGE_KEY, '{not json');
    expect(restoreCncLibrary(storage)).toBeNull();
    expect(storage.getItem(CNC_LIBRARY_STORAGE_KEY)).toBeNull();

    const parsed = parseCncLibrary(
      JSON.stringify({
        customTools: [{ id: 'x', name: 'ok', kind: 'end-mill', diameterMm: 2 }, { junk: true }],
        feedPresets: [{ id: 'p', name: 'bad', feedMmPerMin: -5 }],
        machineProfiles: 'nope',
      }),
    );
    expect(parsed?.customTools).toHaveLength(1);
    expect(parsed?.feedPresets).toHaveLength(0);
    expect(parsed?.machineProfiles).toHaveLength(0);
  });
});
