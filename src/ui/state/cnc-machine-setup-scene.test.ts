import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
} from '../../core/scene';
import { sceneAfterMachineSetup } from './cnc-machine-setup-scene';
import { layerWithCncMaterial } from './cnc-project-material';

describe('sceneAfterMachineSetup', () => {
  it('refreshes automatic recipes when the active CNC bit changes', () => {
    const layer = layerWithCncMaterial({
      layer: {
        ...createLayer({ id: 'operation', color: '#aa0000' }),
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS },
      },
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      profile: DEFAULT_DEVICE_PROFILE,
      materialKey: 'hardwood',
    });
    const base = createProject().scene;
    const machine = { ...DEFAULT_CNC_MACHINE_CONFIG, toolId: 'em-6350' };

    const result = sceneAfterMachineSetup(
      { ...base, layers: [layer] },
      DEFAULT_CNC_MACHINE_CONFIG,
      DEFAULT_DEVICE_PROFILE,
      machine,
      null,
    );

    expect(result.layers[0]?.cnc?.toolId).toBeUndefined();
    expect(result.layers[0]?.cnc?.feedSource).toMatchObject({
      kind: 'material-recipe',
      materialKey: 'hardwood',
    });
    expect(result.layers[0]?.cnc?.feedMmPerMin).not.toBe(layer.cnc?.feedMmPerMin);
  });

  it('refreshes only automatic recipes when Startup changes a pinned bit flute count', () => {
    const automatic = layerWithCncMaterial({
      layer: {
        ...createLayer({ id: 'automatic', color: '#aa0000' }),
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, toolId: 'em-3175' },
      },
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      profile: DEFAULT_DEVICE_PROFILE,
      materialKey: 'hardwood',
    });
    const manual = {
      ...createLayer({ id: 'manual', color: '#00aa00' }),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        toolId: 'em-3175',
        materialKey: 'hardwood',
        feedMmPerMin: 777,
      },
    };
    const machine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: DEFAULT_CNC_MACHINE_CONFIG.tools.map((tool) =>
        tool.id === 'em-3175' ? { ...tool, fluteCount: 3 } : tool,
      ),
    };

    const result = sceneAfterMachineSetup(
      { ...createProject().scene, layers: [automatic, manual] },
      DEFAULT_CNC_MACHINE_CONFIG,
      DEFAULT_DEVICE_PROFILE,
      machine,
      null,
    );

    expect(result.layers[0]?.cnc?.feedSource).toMatchObject({
      kind: 'material-recipe',
      fluteCount: 3,
    });
    expect(result.layers[0]?.cnc?.feedMmPerMin).not.toBe(automatic.cnc?.feedMmPerMin);
    expect(result.layers[1]?.cnc).toEqual(manual.cnc);
  });
});
