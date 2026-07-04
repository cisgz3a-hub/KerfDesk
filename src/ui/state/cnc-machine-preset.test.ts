import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CNC_MACHINE_CATALOG } from '../../core/cnc';
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

  it('is a no-op in laser mode', () => {
    useStore.getState().setMachineKind('laser');
    const beforeBed = useStore.getState().project.device.bedWidth;
    const preset = CNC_MACHINE_CATALOG[0];
    if (preset === undefined) throw new Error('empty catalog');
    useStore.getState().applyCncMachinePreset(preset);
    expect(useStore.getState().project.device.bedWidth).toBe(beforeBed);
  });
});
