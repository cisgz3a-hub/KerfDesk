import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_LAYER_SETTINGS,
  createLayer,
  type CncLayerSettings,
  type Layer,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const STARTER_ID = 'neotronics-4040-shallow-wood-mdf';

function operation(id: string, settings?: CncLayerSettings): Layer {
  const layer = createLayer({ id, color: '#ff0000' });
  return settings === undefined ? layer : { ...layer, cnc: settings };
}

function starterSettings(
  feedMmPerMin: number,
  starterId = STARTER_ID,
  revision = 1,
): CncLayerSettings {
  return {
    ...DEFAULT_CNC_LAYER_SETTINGS,
    feedMmPerMin,
    feedSource: { kind: 'machine-starter', starterId, revision },
  };
}

function materialSettings(
  feedMmPerMin: number,
  overrides: Partial<CncLayerSettings> = {},
): CncLayerSettings {
  return {
    ...DEFAULT_CNC_LAYER_SETTINGS,
    materialKey: 'plywood-mdf',
    feedMmPerMin,
    feedSource: { kind: 'material-recipe', materialKey: 'plywood-mdf', fluteCount: 2 },
    ...overrides,
  };
}

function cncSettings(id: string): CncLayerSettings | undefined {
  return useStore.getState().project.scene.layers.find((layer) => layer.id === id)?.cnc;
}

function requiredCncSettings(id: string): CncLayerSettings {
  const settings = cncSettings(id);
  if (settings === undefined) throw new Error(`CNC settings missing for ${id}`);
  return settings;
}

beforeEach(resetStore);
afterEach(resetStore);

describe('CNC automatic-setting transition policy', () => {
  it('refreshes trusted automatic settings, seeds absent blocks, and preserves manual values on Laser to CNC', () => {
    useStore.getState().replaceDeviceProfile(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    const manual = { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 777 };
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: [
            operation('absent'),
            operation('manual', manual),
            operation('known', starterSettings(333)),
            operation('unknown', starterSettings(444, 'unknown-starter')),
            operation('newer', starterSettings(555, STARTER_ID, 3)),
          ],
        },
      },
    }));

    useStore.getState().setMachineKind('cnc');

    expect(cncSettings('absent')).toMatchObject({
      feedMmPerMin: 300,
      feedSource: { kind: 'machine-starter', starterId: STARTER_ID, revision: 2 },
    });
    expect(cncSettings('manual')).toEqual(manual);
    expect(cncSettings('known')).toMatchObject({ feedMmPerMin: 300 });
    expect(cncSettings('unknown')?.feedMmPerMin).toBe(444);
    expect(cncSettings('unknown')?.feedSource).toBeUndefined();
    expect(cncSettings('newer')?.feedMmPerMin).toBe(555);
    expect(cncSettings('newer')?.feedSource).toBeUndefined();
  });

  it('uses the same refresh-then-seed boundary for unified Machine Setup replacement', () => {
    const manual = { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 777 };
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: [
            operation('absent'),
            operation('automatic', starterSettings(333)),
            operation('manual', manual),
          ],
        },
      },
    }));
    const machine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      params: {
        ...DEFAULT_CNC_MACHINE_CONFIG.params,
        ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.cncSubProfile,
      },
    };

    useStore.getState().replaceMachineSetup(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, machine);

    expect(cncSettings('absent')?.feedMmPerMin).toBe(300);
    expect(cncSettings('automatic')?.feedMmPerMin).toBe(300);
    expect(cncSettings('manual')).toEqual(manual);
  });

  it('refreshes only automatic layers for feed-relevant profile changes', () => {
    useStore.getState().replaceDeviceProfile(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    useStore.getState().setMachineKind('cnc');
    const manual = { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 777 };
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: [operation('automatic', starterSettings(333)), operation('manual', manual)],
        },
      },
    }));
    const sceneBeforeBedEdit = useStore.getState().project.scene;

    useStore.getState().updateDeviceProfile({ bedWidth: 390 });

    expect(useStore.getState().project.scene).toBe(sceneBeforeBedEdit);
    expect(cncSettings('automatic')?.feedMmPerMin).toBe(333);

    useStore.getState().updateDeviceProfile({ maxFeed: 250 });

    expect(cncSettings('automatic')).toMatchObject({
      feedMmPerMin: 250,
      feedSource: { kind: 'machine-starter', starterId: STARTER_ID, revision: 2 },
    });
    expect(cncSettings('manual')).toEqual(manual);
  });

  it('preserves starter numbers but clears rewrite provenance when a replacement profile has no matching starter', () => {
    useStore.getState().replaceDeviceProfile(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    useStore.getState().setMachineKind('cnc');
    const manual = { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 777 };
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: [operation('automatic', starterSettings(333)), operation('manual', manual)],
        },
      },
    }));

    useStore.getState().replaceDeviceProfile(DEFAULT_DEVICE_PROFILE);

    expect(cncSettings('automatic')?.feedMmPerMin).toBe(333);
    expect(cncSettings('automatic')?.feedSource).toBeUndefined();
    expect(cncSettings('manual')).toEqual(manual);
  });

  it('applies saved machine profiles to automatic feeds and synchronizes the device CNC contract', () => {
    useStore.getState().replaceDeviceProfile(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    useStore.getState().setMachineKind('cnc');
    const current = useStore.getState().project.machine;
    if (current?.kind !== 'cnc') throw new Error('CNC machine missing');
    const saved = {
      ...current,
      params: { ...current.params, spindleMaxRpm: 9_000 },
    };
    const manual = { ...DEFAULT_CNC_LAYER_SETTINGS, spindleRpm: 11_000 };
    useStore.setState((state) => ({
      cncLibrary: {
        ...state.cncLibrary,
        machineProfiles: [{ id: 'slow', name: 'Slow spindle', machine: saved }],
      },
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: [
            operation('automatic', materialSettings(600, { spindleRpm: 12_000 })),
            operation('manual', manual),
          ],
        },
      },
    }));

    useStore.getState().applyCncMachineProfile('slow');

    expect(useStore.getState().project.device.cncSubProfile?.spindleMaxRpm).toBe(9_000);
    expect(cncSettings('automatic')?.spindleRpm).toBe(9_000);
    expect(cncSettings('manual')).toEqual(manual);
  });

  it('refreshes inherited flute count when a profile selects another bit without changing pinned or manual intent', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().addCustomCncTool({
      name: '3.175 mm single O-flute',
      kind: 'end-mill',
      diameterMm: 3.175,
      family: 'o-flute-upcut',
      fluteCount: 1,
      catalogId: 'o-upcut-0125',
    });
    const customId = useStore.getState().cncLibrary.customTools[0]?.id;
    if (customId === undefined) throw new Error('Custom tool missing');
    useStore.getState().updateCncMachine({ toolId: customId });
    useStore.getState().saveCncMachineProfile('Single flute');
    useStore.getState().updateCncMachine({ toolId: 'em-3175' });

    const pinned = materialSettings(222, {
      toolId: 'em-6350',
      feedSource: {
        kind: 'material-recipe',
        materialKey: 'plywood-mdf',
        fluteCount: 3,
      },
    });
    const manual = { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 777 };
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: [
            operation('inherited', materialSettings(111)),
            operation('pinned', pinned),
            operation('manual', manual),
          ],
        },
      },
    }));

    const profile = useStore
      .getState()
      .cncLibrary.machineProfiles.find((candidate) => candidate.name === 'Single flute');
    if (profile === undefined) throw new Error('Machine profile missing');
    useStore.getState().applyCncMachineProfile(profile.id);

    const appliedMachine = useStore.getState().project.machine;
    if (appliedMachine?.kind !== 'cnc') throw new Error('CNC machine missing');
    expect(appliedMachine.toolId).toBe(customId);
    expect(appliedMachine.tools.find((tool) => tool.id === customId)?.fluteCount).toBe(1);
    expect(cncSettings('inherited')?.feedSource).toEqual({
      kind: 'material-recipe',
      materialKey: 'plywood-mdf',
      fluteCount: 1,
    });
    expect(cncSettings('inherited')?.feedMmPerMin).not.toBe(111);
    expect(cncSettings('pinned')?.toolId).toBe(pinned.toolId);
    expect(cncSettings('pinned')?.feedSource).toEqual(pinned.feedSource);
    expect(cncSettings('manual')).toEqual(manual);
  });

  it('refreshes inherited and removed overrides when deleting the active bit while preserving pinned and manual intent', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().addCustomCncTool({
      name: '3.175 mm single O-flute',
      kind: 'end-mill',
      diameterMm: 3.175,
      family: 'o-flute-upcut',
      fluteCount: 1,
      catalogId: 'o-upcut-0125',
    });
    const customId = useStore.getState().cncLibrary.customTools[0]?.id;
    if (customId === undefined) throw new Error('Custom tool missing');
    useStore.getState().updateCncMachine({ toolId: customId });
    const manual = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      toolId: customId,
      feedMmPerMin: 777,
    };
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: [
            operation(
              'inherited',
              materialSettings(111, {
                feedSource: {
                  kind: 'material-recipe',
                  materialKey: 'plywood-mdf',
                  fluteCount: 1,
                },
              }),
            ),
            operation(
              'removed-override',
              materialSettings(222, {
                toolId: customId,
                feedSource: {
                  kind: 'material-recipe',
                  materialKey: 'plywood-mdf',
                  fluteCount: 1,
                },
              }),
            ),
            operation(
              'pinned-other',
              materialSettings(333, {
                toolId: 'em-6350',
                feedSource: {
                  kind: 'material-recipe',
                  materialKey: 'plywood-mdf',
                  fluteCount: 3,
                },
              }),
            ),
            operation('manual', manual),
          ],
        },
      },
    }));

    useStore.getState().deleteCustomCncTool(customId);

    const machine = useStore.getState().project.machine;
    if (machine?.kind !== 'cnc') throw new Error('CNC machine missing');
    expect(machine.tools.some((tool) => tool.id === customId)).toBe(false);
    expect(machine.toolId).not.toBe(customId);
    expect(machine.tools.find((tool) => tool.id === machine.toolId)?.fluteCount).toBeUndefined();
    const inherited = requiredCncSettings('inherited');
    const removedOverride = requiredCncSettings('removed-override');
    const pinnedOther = requiredCncSettings('pinned-other');
    expect(inherited.feedSource).toEqual({
      kind: 'material-recipe',
      materialKey: 'plywood-mdf',
      fluteCount: 2,
    });
    expect(inherited.feedMmPerMin).not.toBe(111);
    expect(removedOverride.toolId).toBeUndefined();
    expect(removedOverride.feedSource).toEqual({
      kind: 'material-recipe',
      materialKey: 'plywood-mdf',
      fluteCount: 2,
    });
    expect(removedOverride.feedMmPerMin).not.toBe(222);
    expect(pinnedOther.toolId).toBe('em-6350');
    expect(pinnedOther.feedSource).toEqual({
      kind: 'material-recipe',
      materialKey: 'plywood-mdf',
      fluteCount: 3,
    });
    expect(cncSettings('manual')).toEqual(manual);
  });

  it('recalculates inherited material feeds with a newly selected catalog bit flute count', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().addCustomCncTool({
      name: '3.175 mm single O-flute',
      kind: 'end-mill',
      diameterMm: 3.175,
      family: 'o-flute-upcut',
      fluteCount: 1,
      catalogId: 'o-upcut-0125',
    });
    const customId = useStore.getState().cncLibrary.customTools[0]?.id;
    if (customId === undefined) throw new Error('Custom tool missing');
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: [
            operation('inherited', materialSettings(111)),
            operation(
              'pinned',
              materialSettings(222, {
                toolId: 'em-6350',
                feedSource: {
                  kind: 'material-recipe',
                  materialKey: 'plywood-mdf',
                  fluteCount: 3,
                },
              }),
            ),
          ],
        },
      },
    }));

    useStore.getState().updateCncMachine({ toolId: customId });

    expect(cncSettings('inherited')?.feedSource).toEqual({
      kind: 'material-recipe',
      materialKey: 'plywood-mdf',
      fluteCount: 1,
    });
    expect(cncSettings('inherited')?.feedMmPerMin).not.toBe(111);
    expect(cncSettings('pinned')?.feedSource).toEqual({
      kind: 'material-recipe',
      materialKey: 'plywood-mdf',
      fluteCount: 3,
    });
  });
});
