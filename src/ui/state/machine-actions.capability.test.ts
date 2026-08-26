import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, LASER_MACHINE_CONFIG } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => resetStore());
afterEach(() => resetStore());

describe('machine mode capability warnings', () => {
  it('selects CNC mode for a laser-only-labelled machine without a policy refusal', () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: { ...state.project.device, capabilities: ['laser-output'] },
        machine: LASER_MACHINE_CONFIG,
      },
      dirty: false,
    }));
    const before = useStore.getState();

    const result = before.setMachineKind('cnc');

    const after = useStore.getState();
    expect(result).toEqual({ kind: 'selected', machineKind: 'cnc' });
    expect(after.project.machine?.kind).toBe('cnc');
    expect(after.undoStack).toHaveLength(1);
    expect(after.dirty).toBe(true);
  });

  it('selects Laser mode for a CNC-only-labelled machine', () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: {
          ...state.project.device,
          capabilities: ['cnc-output'],
          cncSubProfile: DEFAULT_CNC_MACHINE_CONFIG.params,
        },
        machine: DEFAULT_CNC_MACHINE_CONFIG,
      },
    }));

    const result = useStore.getState().setMachineKind('laser');

    expect(result).toEqual({ kind: 'selected', machineKind: 'laser' });
    expect(useStore.getState().project.machine).toEqual(LASER_MACHINE_CONFIG);
  });

  it('allows both directions for a hybrid machine', () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: {
          ...state.project.device,
          capabilities: ['laser-output', 'cnc-output'],
          cncSubProfile: DEFAULT_CNC_MACHINE_CONFIG.params,
        },
        machine: LASER_MACHINE_CONFIG,
      },
    }));

    expect(useStore.getState().setMachineKind('cnc')).toEqual({
      kind: 'selected',
      machineKind: 'cnc',
    });
    expect(useStore.getState().setMachineKind('laser')).toEqual({
      kind: 'selected',
      machineKind: 'laser',
    });
  });

  it('applies an inconsistent atomic Machine Setup replacement with a warning result', () => {
    const before = useStore.getState();
    const laserOnlyProfile = {
      ...before.project.device,
      capabilities: ['laser-output'] as const,
    };

    const result = before.replaceMachineSetup(laserOnlyProfile, DEFAULT_CNC_MACHINE_CONFIG);

    expect(result).toEqual({ kind: 'applied-with-capability-warning', requestedKind: 'cnc' });
    expect(useStore.getState().project.machine?.kind).toBe('cnc');
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
});
