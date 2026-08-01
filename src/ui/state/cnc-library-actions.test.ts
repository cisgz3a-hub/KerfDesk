import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_TOOLS,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type Layer,
  type ReliefObject,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { feedPresetPatch } from './cnc-library-actions';
import {
  CNC_LIBRARY_STORAGE_KEY,
  parseCncLibrary,
  persistCncLibrary,
  restoreCncLibrary,
} from './cnc-library-persistence';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { cncMachineWithCustomTools } from './machine-actions';

beforeEach(() => {
  resetStore();
  useStore.setState({ cncLibrary: { customTools: [], feedPresets: [], machineProfiles: [] } });
});

const SECONDARY_REFERENCE_CASES = [
  {
    field: 'vClearToolId',
    activePatch: { cutType: 'v-carve' },
    dormantPatch: { cutType: 'engrave' },
    relief: false,
  },
  {
    field: 'reliefFinishToolId',
    activePatch: {},
    dormantPatch: {},
    relief: true,
  },
  {
    field: 'pocketRoughToolId',
    activePatch: { cutType: 'pocket', pocketStrategy: 'offset' },
    dormantPatch: { cutType: 'pocket', pocketStrategy: 'adaptive' },
    relief: false,
  },
] as const;

function installSecondaryReference(
  field: (typeof SECONDARY_REFERENCE_CASES)[number]['field'],
  toolId: string,
  patch: Partial<CncLayerSettings>,
  withRelief: boolean,
): void {
  const settings: CncLayerSettings = { ...DEFAULT_CNC_LAYER_SETTINGS, ...patch, [field]: toolId };
  const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), cnc: settings };
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: { objects: [objectForLayer(layer, withRelief)], layers: [layer] },
    },
  }));
}

function objectForLayer(
  layer: Layer,
  relief: boolean,
): ReliefObject | ReturnType<typeof createRectangle> {
  if (!relief) {
    return createRectangle({
      id: 'R1',
      color: layer.color,
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    });
  }
  return {
    kind: 'relief',
    id: 'R1',
    source: 'model.stl',
    meshPositions: [0, 0, 0, 10, 0, 0, 0, 5, 5],
    targetWidthMm: 10,
    reliefDepthMm: 2,
    emptyCells: 'floor',
    color: layer.color,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: IDENTITY_TRANSFORM,
  };
}

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

  it('preserves a project tool instead of merging a second ID for the same catalog entry', () => {
    const imported = {
      id: 'project-catalog-id',
      name: 'Project copy',
      kind: 'end-mill' as const,
      diameterMm: 3.175,
      catalogId: 'o-upcut-0125',
    };
    const saved = {
      ...imported,
      id: 'saved-library-id',
      name: 'Saved copy',
      family: 'o-flute-upcut',
      fluteCount: 1,
    };
    const merged = cncMachineWithCustomTools(
      { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, imported] },
      [saved],
    );

    expect(merged.tools.filter((tool) => tool.catalogId === imported.catalogId)).toEqual([
      imported,
    ]);
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

  it.each(SECONDARY_REFERENCE_CASES)(
    'refuses to delete a bit used by the active $field stage',
    ({ field, activePatch, relief }) => {
      useStore.getState().setMachineKind('cnc');
      useStore.getState().addCustomCncTool({ name: 'Staged bit', kind: 'end-mill', diameterMm: 4 });
      const id = useStore.getState().cncLibrary.customTools[0]?.id;
      if (id === undefined) throw new Error('custom tool missing');
      installSecondaryReference(field, id, activePatch, relief);
      const before = useStore.getState();

      before.deleteCustomCncTool(id);

      const after = useStore.getState();
      expect(after.project).toBe(before.project);
      expect(after.cncLibrary).toBe(before.cncLibrary);
      expect(after.cncLibrary.customTools.some((tool) => tool.id === id)).toBe(true);
      const machine = after.project.machine;
      if (machine?.kind !== 'cnc') throw new Error('cnc machine missing');
      expect(machine.tools.some((tool) => tool.id === id)).toBe(true);
      expect(after.undoStack).toBe(before.undoStack);
      expect(after.dirty).toBe(before.dirty);
    },
  );

  it.each(SECONDARY_REFERENCE_CASES)(
    'deletes the bit and clears a dormant $field reference',
    ({ field, dormantPatch, relief }) => {
      useStore.getState().setMachineKind('cnc');
      useStore
        .getState()
        .addCustomCncTool({ name: 'Dormant bit', kind: 'end-mill', diameterMm: 4 });
      const id = useStore.getState().cncLibrary.customTools[0]?.id;
      if (id === undefined) throw new Error('custom tool missing');
      installSecondaryReference(
        field,
        id,
        dormantPatch,
        field === 'reliefFinishToolId' ? false : relief,
      );

      useStore.getState().deleteCustomCncTool(id);

      const after = useStore.getState();
      expect(after.cncLibrary.customTools.some((tool) => tool.id === id)).toBe(false);
      expect(after.project.scene.layers[0]?.cnc?.[field]).toBeUndefined();
      const machine = after.project.machine;
      if (machine?.kind !== 'cnc') throw new Error('cnc machine missing');
      expect(machine.tools.some((tool) => tool.id === id)).toBe(false);
    },
  );
  it('does not add the same catalog entry twice', () => {
    useStore.getState().setMachineKind('cnc');
    const catalogTool = {
      name: '3.175 mm single O-flute',
      kind: 'end-mill' as const,
      diameterMm: 3.175,
      family: 'o-flute-upcut',
      fluteCount: 1,
      catalogId: 'o-upcut-0125',
    };

    useStore.getState().addCustomCncTool(catalogTool);
    useStore.getState().addCustomCncTool(catalogTool);

    const state = useStore.getState();
    expect(state.cncLibrary.customTools).toHaveLength(1);
    const machine = state.project.machine;
    if (machine?.kind !== 'cnc') throw new Error('cnc machine missing');
    expect(machine.tools.filter((tool) => tool.catalogId === catalogTool.catalogId)).toHaveLength(
      1,
    );
  });

  it('does not copy a built-in catalog bit into the deletable custom library', () => {
    useStore.getState().addCustomCncTool({
      name: '90° point V-bit',
      kind: 'v-bit',
      diameterMm: 6.35,
      tipAngleDeg: 90,
      family: 'v-groove',
      catalogId: 'v90-hobby-0125',
    });

    expect(useStore.getState().cncLibrary.customTools).toHaveLength(0);
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

  it('keeps custom bits added after the profile was saved', () => {
    // Applying a profile used to replace machine.tools wholesale, silently
    // deleting later-added custom bits; layers referencing them fell back to
    // the machine bit without a word.
    useStore.getState().setMachineKind('cnc');
    useStore.getState().saveCncMachineProfile('base');
    const machine = useStore.getState().project.machine;
    if (machine?.kind !== 'cnc') throw new Error('cnc machine missing');
    const custom = {
      id: 'custom-2mm',
      name: '2 mm end mill',
      kind: 'end-mill' as const,
      diameterMm: 2,
    };
    useStore.getState().updateCncMachine({ tools: [...machine.tools, custom] });

    const profile = useStore.getState().cncLibrary.machineProfiles[0];
    if (profile === undefined) throw new Error('profile missing');
    useStore.getState().applyCncMachineProfile(profile.id);

    const applied = useStore.getState().project.machine;
    if (applied?.kind !== 'cnc') throw new Error('cnc machine missing');
    expect(applied.tools.some((tool) => tool.id === 'custom-2mm')).toBe(true);
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
    useStore.getState().addCustomCncTool({
      name: 'RT',
      kind: 'ball-nose',
      diameterMm: 3,
      family: 'ball-nose',
      shankDiameterMm: 6,
      fluteCount: 2,
      catalogId: 'ball-m300',
    });
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
    expect(parsed?.customTools[0]).toEqual({
      id: 'x',
      name: 'ok',
      kind: 'end-mill',
      diameterMm: 2,
    });
    expect(parsed?.feedPresets).toHaveLength(0);
    expect(parsed?.machineProfiles).toHaveLength(0);
  });

  it.each([0.5, 179.5])('drops an out-of-contract %s degree persisted angle', (tipAngleDeg) => {
    const parsed = parseCncLibrary(
      JSON.stringify({
        customTools: [{ id: 'v', name: 'V-bit', kind: 'v-bit', diameterMm: 3, tipAngleDeg }],
      }),
    );
    expect(parsed?.customTools).toEqual([{ id: 'v', name: 'V-bit', kind: 'v-bit', diameterMm: 3 }]);
  });

  it.each([0.5, 179.5])(
    'normalizes an out-of-contract %s degree tool inside a saved machine profile',
    (tipAngleDeg) => {
      const parsed = parseCncLibrary(
        JSON.stringify({
          machineProfiles: [
            {
              id: 'profile-v',
              name: 'Preserved profile',
              machine: {
                ...DEFAULT_CNC_MACHINE_CONFIG,
                stock: { thicknessMm: 12 },
                tools: [
                  { id: 'v', name: 'Profile V-bit', kind: 'v-bit', diameterMm: 3, tipAngleDeg },
                ],
                toolId: 'v',
              },
            },
          ],
        }),
      );

      expect(parsed?.machineProfiles).toEqual([
        {
          id: 'profile-v',
          name: 'Preserved profile',
          machine: {
            ...DEFAULT_CNC_MACHINE_CONFIG,
            stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 12 },
            tools: [{ id: 'v', name: 'Profile V-bit', kind: 'v-bit', diameterMm: 3 }],
            toolId: 'v',
          },
        },
      ]);
    },
  );

  it('falls back to the first valid saved-profile tool when its active id is invalid', () => {
    const parsed = parseCncLibrary(
      JSON.stringify({
        machineProfiles: [
          {
            id: 'profile-fallback',
            name: 'Fallback profile',
            machine: { ...DEFAULT_CNC_MACHINE_CONFIG, toolId: 'missing' },
          },
        ],
      }),
    );

    expect(parsed?.machineProfiles[0]?.machine.toolId).toBe(DEFAULT_CNC_TOOLS[0]?.id);
  });

  it('drops malformed optional tool metadata field-safely', () => {
    const parsed = parseCncLibrary(
      JSON.stringify({
        customTools: [
          {
            id: 'x',
            name: 'still valid',
            kind: 'end-mill',
            diameterMm: 2,
            family: 'x'.repeat(121),
            shankDiameterMm: -6,
            fluteCount: 17,
            catalogId: '',
          },
        ],
        feedPresets: [],
        machineProfiles: [],
      }),
    );
    expect(parsed?.customTools).toEqual([
      { id: 'x', name: 'still valid', kind: 'end-mill', diameterMm: 2 },
    ]);
  });
});
