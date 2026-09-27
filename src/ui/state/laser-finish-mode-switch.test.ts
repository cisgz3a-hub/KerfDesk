// ADR-493 with ADR-416: the laser finish position and saved head positions are
// machine fields on the shared DeviceProfile, not per-head settings, so a trip
// through CNC mode and back keeps them.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LASER_MACHINE_CONFIG } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  resetStore();
  useStore.setState({ cachedCncMachine: null });
});

afterEach(() => resetStore());

describe('laser finish position across a mode switch', () => {
  it('survives Laser -> CNC -> Laser', () => {
    const savedPositions = [{ name: 'Jig', frame: 'bed' as const, xMm: 1, yMm: 2 }];
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: {
          ...state.project.device,
          capabilities: ['laser-output', 'cnc-output'],
          laserFinishPosition: { kind: 'bed', xMm: 10, yMm: 0 },
          savedPositions,
        },
        machine: LASER_MACHINE_CONFIG,
      },
    }));

    useStore.getState().setMachineKind('cnc');
    expect(useStore.getState().project.device.laserFinishPosition).toEqual({
      kind: 'bed',
      xMm: 10,
      yMm: 0,
    });
    useStore.getState().setMachineKind('laser');

    const { device } = useStore.getState().project;
    expect(device.laserFinishPosition).toEqual({ kind: 'bed', xMm: 10, yMm: 0 });
    expect(device.savedPositions).toEqual(savedPositions);
  });
});
