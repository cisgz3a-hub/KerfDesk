import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  type CncLayerSettings,
  type CncMachineConfig,
} from '../../core/scene';
import { mergeCncMachineProfileForCurrentProject } from './cnc-machine-profile-merge';
import { useStore } from './store';
import { resetStore } from './test-helpers';

function operation(id: string, cnc: CncLayerSettings) {
  return { ...createLayer({ id, color: '#ff0000' }), cnc };
}

function materialSettings(
  feedMmPerMin: number,
  fluteCount: number,
  overrides: Partial<CncLayerSettings> = {},
): CncLayerSettings {
  return {
    ...DEFAULT_CNC_LAYER_SETTINGS,
    materialKey: 'plywood-mdf',
    feedMmPerMin,
    feedSource: { kind: 'material-recipe', materialKey: 'plywood-mdf', fluteCount },
    ...overrides,
  };
}

function currentCncMachine(): CncMachineConfig {
  const machine = useStore.getState().project.machine;
  if (machine?.kind !== 'cnc') throw new Error('CNC machine missing');
  return machine;
}

function requiredCncSettings(id: string): CncLayerSettings {
  const settings = useStore.getState().project.scene.layers.find((layer) => layer.id === id)?.cnc;
  if (settings === undefined) throw new Error(`CNC settings missing for ${id}`);
  return settings;
}

beforeEach(() => {
  resetStore();
  useStore.setState({ cncLibrary: { customTools: [], feedPresets: [], machineProfiles: [] } });
});

describe('CNC catalog transition integrity', () => {
  it('adopts the active imported catalog copy and refreshes inherited flute intent only', () => {
    useStore.getState().setMachineKind('cnc');
    const machine = currentCncMachine();
    const imported = {
      id: 'imported-o-flute',
      name: 'Imported label',
      kind: 'end-mill' as const,
      diameterMm: 3.175,
      catalogId: 'o-upcut-0125',
    };
    const earlierDuplicate = { ...imported, id: 'earlier-o-flute' };
    const inherited = materialSettings(111, 2);
    const pinned = materialSettings(222, 3, { toolId: 'em-6350' });
    const manual = { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 777 };
    useStore.setState((state) => ({
      project: {
        ...state.project,
        machine: {
          ...machine,
          tools: [...machine.tools, earlierDuplicate, imported],
          toolId: imported.id,
        },
        scene: {
          ...state.project.scene,
          layers: [
            operation('inherited', inherited),
            operation('pinned', pinned),
            operation('manual', manual),
          ],
        },
      },
    }));

    useStore.getState().addCustomCncTool({
      name: '3.175 mm single O-flute',
      kind: 'end-mill',
      diameterMm: 3.175,
      family: 'o-flute-upcut',
      fluteCount: 1,
      catalogId: 'o-upcut-0125',
    });

    const applied = currentCncMachine();
    expect(useStore.getState().cncLibrary.customTools[0]?.id).toBe(imported.id);
    expect(applied.tools.find((tool) => tool.id === imported.id)).toMatchObject({
      family: 'o-flute-upcut',
      fluteCount: 1,
    });
    expect(applied.tools.find((tool) => tool.id === earlierDuplicate.id)).toEqual(earlierDuplicate);
    expect(requiredCncSettings('inherited')).toMatchObject({
      feedSource: { kind: 'material-recipe', fluteCount: 1 },
    });
    expect(requiredCncSettings('inherited').feedMmPerMin).not.toBe(inherited.feedMmPerMin);
    expect(requiredCncSettings('pinned')).toMatchObject({
      toolId: pinned.toolId,
      feedSource: pinned.feedSource,
    });
    expect(requiredCncSettings('manual')).toEqual(manual);
  });

  it('restores shared defaults and assumed flutes when deleting the sole active tool', () => {
    useStore.getState().setMachineKind('cnc');
    const machine = currentCncMachine();
    const soleTool = {
      id: 'sole-o-flute',
      name: 'Sole O-flute',
      kind: 'end-mill' as const,
      diameterMm: 3.175,
      family: 'o-flute-upcut',
      fluteCount: 1,
      catalogId: 'o-upcut-0125',
    };
    useStore.setState((state) => ({
      cncLibrary: { ...state.cncLibrary, customTools: [soleTool] },
      project: {
        ...state.project,
        machine: { ...machine, tools: [soleTool], toolId: soleTool.id },
        scene: {
          ...state.project.scene,
          layers: [operation('sole-inherited', materialSettings(111, 1))],
        },
      },
    }));

    useStore.getState().deleteCustomCncTool(soleTool.id);

    const restored = currentCncMachine();
    expect(restored.tools).toEqual(DEFAULT_CNC_MACHINE_CONFIG.tools);
    expect(restored.toolId).toBe(DEFAULT_CNC_MACHINE_CONFIG.toolId);
    expect(restored.tools.some((tool) => tool.id === restored.toolId)).toBe(true);
    expect(requiredCncSettings('sole-inherited').feedMmPerMin).not.toBe(111);
    expect(requiredCncSettings('sole-inherited').feedSource).toEqual({
      kind: 'material-recipe',
      materialKey: 'plywood-mdf',
      fluteCount: 2,
    });
  });

  it('repairs empty profile and current tool tables with shared defaults', () => {
    const emptyMachine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: [],
      toolId: 'missing-tool',
    };

    const merged = mergeCncMachineProfileForCurrentProject(emptyMachine, emptyMachine);

    expect(merged.tools).toEqual(DEFAULT_CNC_MACHINE_CONFIG.tools);
    expect(merged.toolId).toBe(DEFAULT_CNC_MACHINE_CONFIG.toolId);
    expect(merged.tools.some((tool) => tool.id === merged.toolId)).toBe(true);
  });

  it('restores profile metadata for an exact tool id', () => {
    const currentTool = {
      id: 'shared-tool',
      name: 'Current metadata',
      kind: 'end-mill' as const,
      diameterMm: 4,
    };
    const profileTool = { ...currentTool, name: 'Profile metadata', diameterMm: 3 };
    const currentMachine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, currentTool],
    };
    const profileMachine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, profileTool],
    };

    const merged = mergeCncMachineProfileForCurrentProject(profileMachine, currentMachine);

    expect(merged.tools.find((tool) => tool.id === currentTool.id)).toEqual(profileTool);
  });

  it('reserves a later exact profile snapshot before canonicalizing an earlier alias', () => {
    useStore.getState().setMachineKind('cnc');
    const machine = currentCncMachine();
    const currentTool = {
      id: 'shared-active-tool',
      name: 'Current two-flute metadata',
      kind: 'end-mill' as const,
      diameterMm: 3.175,
      fluteCount: 2,
      catalogId: 'profile-order-alias',
    };
    const profileAlias = {
      ...currentTool,
      id: 'earlier-profile-alias',
      name: 'Earlier profile alias',
      fluteCount: 1,
    };
    const profileExact = {
      ...currentTool,
      name: 'Profile single-flute metadata',
      fluteCount: 1,
    };
    useStore.setState((state) => ({
      cncLibrary: {
        ...state.cncLibrary,
        machineProfiles: [
          {
            id: 'ordered-alias-profile',
            name: 'Ordered alias profile',
            machine: {
              ...machine,
              tools: [...machine.tools, profileAlias, profileExact],
              toolId: profileExact.id,
            },
          },
        ],
      },
      project: {
        ...state.project,
        machine: {
          ...machine,
          tools: [...machine.tools, currentTool],
          toolId: currentTool.id,
        },
        scene: {
          ...state.project.scene,
          layers: [operation('ordered-alias-feed', materialSettings(111, 2))],
        },
      },
    }));

    useStore.getState().applyCncMachineProfile('ordered-alias-profile');

    const applied = currentCncMachine();
    expect(applied.tools.filter((tool) => tool.catalogId === currentTool.catalogId)).toEqual([
      profileExact,
    ]);
    expect(applied.toolId).toBe(profileExact.id);
    expect(requiredCncSettings('ordered-alias-feed')).toMatchObject({
      feedSource: { kind: 'material-recipe', fluteCount: 1 },
    });
    expect(requiredCncSettings('ordered-alias-feed').feedMmPerMin).not.toBe(111);
  });

  it('maps an active duplicate profile alias to the first retained incoming tool', () => {
    const first = {
      id: 'profile-first',
      name: 'Profile first',
      kind: 'end-mill' as const,
      diameterMm: 3.175,
      catalogId: 'malformed-profile-alias',
    };
    const activeAlias = { ...first, id: 'profile-active', name: 'Profile active alias' };
    const profileMachine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, first, activeAlias],
      toolId: activeAlias.id,
    };

    const merged = mergeCncMachineProfileForCurrentProject(
      profileMachine,
      DEFAULT_CNC_MACHINE_CONFIG,
    );

    expect(merged.tools.filter((tool) => tool.catalogId === first.catalogId)).toEqual([first]);
    expect(merged.toolId).toBe(first.id);
    expect(merged.tools.some((tool) => tool.id === merged.toolId)).toBe(true);
  });

  it('canonicalizes incoming aliases while retaining all four current layer references', () => {
    useStore.getState().setMachineKind('cnc');
    const machine = currentCncMachine();
    const catalogTool = {
      name: 'Single O-flute',
      kind: 'end-mill' as const,
      diameterMm: 3.175,
      fluteCount: 1,
      catalogId: 'o-upcut-0125',
    };
    const currentFirst = { ...catalogTool, id: 'current-first' };
    const currentActive = { ...catalogTool, id: 'current-active' };
    const profileFirst = { ...catalogTool, id: 'profile-first' };
    const profileActive = { ...catalogTool, id: 'profile-active' };
    const referencedSettings: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      toolId: currentFirst.id,
      vClearToolId: currentActive.id,
      reliefFinishToolId: currentFirst.id,
      pocketRoughToolId: currentActive.id,
    };
    useStore.setState((state) => ({
      cncLibrary: {
        ...state.cncLibrary,
        machineProfiles: [
          {
            id: 'duplicate-profile',
            name: 'Duplicate profile',
            machine: {
              ...machine,
              tools: [...machine.tools, profileFirst, profileActive],
              toolId: profileActive.id,
            },
          },
        ],
      },
      project: {
        ...state.project,
        machine: {
          ...machine,
          tools: [...machine.tools, currentFirst, currentActive],
          toolId: currentActive.id,
        },
        scene: {
          ...state.project.scene,
          layers: [operation('all-tool-references', referencedSettings)],
        },
      },
    }));

    useStore.getState().applyCncMachineProfile('duplicate-profile');

    const applied = currentCncMachine();
    const catalogCopies = applied.tools.filter((tool) => tool.catalogId === catalogTool.catalogId);
    expect(catalogCopies).toHaveLength(2);
    expect(catalogCopies).toEqual(expect.arrayContaining([currentFirst, currentActive]));
    expect(catalogCopies.some((tool) => tool.id === profileFirst.id)).toBe(false);
    expect(catalogCopies.some((tool) => tool.id === profileActive.id)).toBe(false);
    expect(applied.toolId).toBe(currentActive.id);
    expect(requiredCncSettings('all-tool-references')).toMatchObject(referencedSettings);
  });
});
