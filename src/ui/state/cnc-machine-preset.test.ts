import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CNC_MACHINE_CATALOG } from '../../core/cnc';
import { DEFAULT_CNC_LAYER_SETTINGS, createLayer } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  resetStore();
  useStore.getState().setMachineKind('cnc');
});
afterEach(() => resetStore());

function spindleMax(): number {
  const machine = useStore.getState().project.machine;
  return machine?.kind === 'cnc' ? machine.params.spindleMaxRpm : 0;
}

describe('applyCncMachinePreset', () => {
  it('seeds the device bed and CNC spindle max in one undoable step', () => {
    const preset = CNC_MACHINE_CATALOG.find((candidate) => candidate.id === 'shapeoko-xxl');
    if (preset === undefined) throw new Error('preset missing');
    const beforeBed = useStore.getState().project.device.bedWidth;

    useStore.getState().applyCncMachinePreset(preset);

    expect(useStore.getState().project.device.bedWidth).toBe(preset.bedWidthMm);
    expect(useStore.getState().project.device.bedHeight).toBe(preset.bedHeightMm);
    expect(useStore.getState().project.workspace.width).toBe(preset.bedWidthMm);
    expect(useStore.getState().project.workspace.height).toBe(preset.bedHeightMm);
    expect(spindleMax()).toBe(preset.spindleMaxRpm);
    expect(useStore.getState().dirty).toBe(true);

    useStore.getState().undo();
    expect(useStore.getState().project.device.bedWidth).toBe(beforeBed);
  });

  it('refreshes automatic material settings without rewriting manual layers', () => {
    // Genmitsu presets cap at 10000 RPM while the layer default is 12000 —
    // Only settings carrying automatic provenance may follow the new ceiling;
    // absent provenance means manual or legacy operator intent.
    const preset = CNC_MACHINE_CATALOG.find((candidate) => candidate.id === 'genmitsu-3018');
    if (preset === undefined) throw new Error('preset missing');
    const manual = {
      ...createLayer({ id: 'manual', color: '#ff0000' }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, spindleRpm: 12000 },
    };
    const legacy = {
      ...createLayer({ id: 'legacy', color: '#00ff00' }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, spindleRpm: 8000 },
    };
    const automatic = {
      ...createLayer({ id: 'automatic', color: '#0000ff' }),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        materialKey: 'plywood-mdf' as const,
        spindleRpm: 12000,
        feedSource: {
          kind: 'material-recipe' as const,
          materialKey: 'plywood-mdf',
          fluteCount: 2,
        },
      },
    };
    useStore.setState((s) => ({
      project: {
        ...s.project,
        scene: { ...s.project.scene, layers: [manual, legacy, automatic] },
      },
    }));

    useStore.getState().applyCncMachinePreset(preset);

    const layers = useStore.getState().project.scene.layers;
    expect(layers.find((layer) => layer.id === 'manual')?.cnc?.spindleRpm).toBe(12000);
    expect(layers.find((layer) => layer.id === 'legacy')?.cnc?.spindleRpm).toBe(8000);
    expect(layers.find((layer) => layer.id === 'automatic')?.cnc?.spindleRpm).toBe(10000);
  });

  it('is a no-op in laser mode', () => {
    useStore.getState().setMachineKind('laser');
    const beforeBed = useStore.getState().project.device.bedWidth;
    const preset = CNC_MACHINE_CATALOG[0];
    if (preset === undefined) throw new Error('empty catalog');
    useStore.getState().applyCncMachinePreset(preset);
    expect(useStore.getState().project.device.bedWidth).toBe(beforeBed);
  });
});
