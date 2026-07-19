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
            operation('newer', starterSettings(555, STARTER_ID, 2)),
          ],
        },
      },
    }));

    useStore.getState().setMachineKind('cnc');

    expect(cncSettings('absent')).toMatchObject({
      feedMmPerMin: 600,
      feedSource: { kind: 'machine-starter', starterId: STARTER_ID, revision: 1 },
    });
    expect(cncSettings('manual')).toEqual(manual);
    expect(cncSettings('known')).toMatchObject({ feedMmPerMin: 600 });
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

    expect(cncSettings('absent')?.feedMmPerMin).toBe(600);
    expect(cncSettings('automatic')?.feedMmPerMin).toBe(600);
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

    useStore.getState().updateDeviceProfile({ maxFeed: 500 });

    expect(cncSettings('automatic')).toMatchObject({
      feedMmPerMin: 500,
      feedSource: { kind: 'machine-starter', starterId: STARTER_ID, revision: 1 },
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

  it('removes a deleted tool override only from automatic material recipes and recalculates them', () => {
    useStore.getState().setMachineKind('cnc');
    useStore
      .getState()
      .addCustomCncTool({ name: 'Wide custom bit', kind: 'end-mill', diameterMm: 6.35 });
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
            operation('automatic', materialSettings(111, { toolId: customId })),
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
    expect(cncSettings('automatic')?.toolId).toBeUndefined();
    expect(cncSettings('automatic')?.feedMmPerMin).not.toBe(111);
    expect(cncSettings('automatic')?.feedSource?.kind).toBe('material-recipe');
    expect(cncSettings('manual')).toEqual(manual);
  });
});
