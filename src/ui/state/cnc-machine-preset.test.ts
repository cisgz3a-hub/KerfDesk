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
    expect(spindleMax()).toBe(preset.spindleMaxRpm);
    expect(useStore.getState().dirty).toBe(true);

    useStore.getState().undo();
    expect(useStore.getState().project.device.bedWidth).toBe(beforeBed);
  });

  it('clamps layer spindle RPMs above the new preset ceiling', () => {
    // Genmitsu presets cap at 10000 RPM while the layer default is 12000 —
    // without clamping, preflight rejects every export until the user edits
    // each layer by hand (Easel clamps to machine limits instead).
    const preset = CNC_MACHINE_CATALOG.find((candidate) => candidate.id === 'genmitsu-3018');
    if (preset === undefined) throw new Error('preset missing');
    const hot = {
      ...createLayer({ id: 'hot', color: '#ff0000' }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, spindleRpm: 12000 },
    };
    const cool = {
      ...createLayer({ id: 'cool', color: '#00ff00' }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, spindleRpm: 8000 },
    };
    useStore.setState((s) => ({
      project: { ...s.project, scene: { ...s.project.scene, layers: [hot, cool] } },
    }));

    useStore.getState().applyCncMachinePreset(preset);

    const layers = useStore.getState().project.scene.layers;
    expect(layers.find((layer) => layer.id === 'hot')?.cnc?.spindleRpm).toBe(10000);
    expect(layers.find((layer) => layer.id === 'cool')?.cnc?.spindleRpm).toBe(8000);
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
