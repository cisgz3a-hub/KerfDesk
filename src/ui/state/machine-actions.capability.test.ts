import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, LASER_MACHINE_CONFIG } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => resetStore());
afterEach(() => resetStore());

describe('machine mode capability enforcement', () => {
  it('rejects CNC mode for a laser-only machine without mutating project state', () => {
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
    expect(result).toEqual({ kind: 'blocked-by-capability', requestedKind: 'cnc' });
    expect(after.project).toBe(before.project);
    expect(after.undoStack).toBe(before.undoStack);
    expect(after.redoStack).toBe(before.redoStack);
    expect(after.cachedCncMachine).toBe(before.cachedCncMachine);
    expect(after.dirty).toBe(false);
  });

  it('rejects Laser mode for a CNC-only machine', () => {
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

    expect(result).toEqual({ kind: 'blocked-by-capability', requestedKind: 'laser' });
    expect(useStore.getState().project.machine).toEqual(DEFAULT_CNC_MACHINE_CONFIG);
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

  it('refuses an inconsistent atomic Machine Setup replacement', () => {
    const before = useStore.getState();
    const laserOnlyProfile = {
      ...before.project.device,
      capabilities: ['laser-output'] as const,
    };

    const result = before.replaceMachineSetup(laserOnlyProfile, DEFAULT_CNC_MACHINE_CONFIG);

    expect(result).toEqual({ kind: 'blocked-by-capability', requestedKind: 'cnc' });
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
  });
});
