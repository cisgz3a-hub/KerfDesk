import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, LASER_MACHINE_CONFIG } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  resetStore();
  useStore.setState({ cachedCncMachine: null });
});

afterEach(() => resetStore());

describe('hybrid machine mode switching', () => {
  it('restores persisted CNC settings and keeps edits when returning to Laser mode', () => {
    const persistedParams = {
      ...DEFAULT_CNC_MACHINE_CONFIG.params,
      safeZMm: 14,
      spindleMaxRpm: 18000,
    };
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: {
          ...state.project.device,
          capabilities: ['laser-output', 'cnc-output'],
          cncSubProfile: persistedParams,
        },
        machine: LASER_MACHINE_CONFIG,
      },
    }));

    useStore.getState().setMachineKind('cnc');

    const restored = useStore.getState().project.machine;
    expect(restored?.kind).toBe('cnc');
    if (restored?.kind !== 'cnc') throw new Error('expected CNC mode');
    expect(restored.params).toEqual(persistedParams);

    useStore.getState().updateCncMachine({ params: { safeZMm: 19 } });
    expect(useStore.getState().project.device.cncSubProfile?.safeZMm).toBe(19);

    useStore.getState().setMachineKind('laser');
    expect(useStore.getState().project.machine).toEqual(LASER_MACHINE_CONFIG);
    expect(useStore.getState().project.device.cncSubProfile?.safeZMm).toBe(19);

    useStore.getState().setMachineKind('cnc');
    const restoredAgain = useStore.getState().project.machine;
    expect(restoredAgain?.kind).toBe('cnc');
    if (restoredAgain?.kind !== 'cnc') throw new Error('expected CNC mode');
    expect(restoredAgain.params.safeZMm).toBe(19);
  });
});
