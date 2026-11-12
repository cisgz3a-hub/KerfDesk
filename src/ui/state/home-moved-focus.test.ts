import { beforeEach, describe, expect, it } from 'vitest';
import { demotedPolicyWarnings } from '../laser/start-job-readiness-policy';
import { machineSnapshot } from '../laser/start-machine-snapshot';
import { useCameraStore } from './camera-store';
import {
  FOCUS_SET_PATCH,
  focusMovedByHome,
  HOME_MOVED_FOCUS_JOB_WARNING,
  homeMovedFocusPatch,
  homeMovesFocus,
} from './home-moved-focus';
import { jogStartPatch } from './jog-held-frame';
import type { LaserMotionOperation } from './laser-motion-operation';
import { useLaserStore, type LaserState } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const A1_PRO = 'creality-falcon-a1-pro' as const;

function focusState(
  commandSet: LaserState['activeControllerCommandSet'],
  epoch: number,
  movedEpoch: number | null = null,
) {
  return {
    activeControllerCommandSet: commandSet,
    controllerSessionEpoch: epoch,
    focusMovedByHomeEpoch: movedEpoch,
  };
}

beforeEach(() => {
  resetStore();
});

describe('which machines Home moves the focus on (ADR-322 Amendment 5)', () => {
  it('knows only the Falcon A1 Pro command set, where it was observed', () => {
    expect(homeMovesFocus(A1_PRO)).toBe(true);
    expect(homeMovesFocus(null)).toBe(false);
  });

  it('records the session a Home started in, on the A1 Pro only', () => {
    expect(homeMovedFocusPatch(focusState(A1_PRO, 7))).toEqual({ focusMovedByHomeEpoch: 7 });
    expect(homeMovedFocusPatch(focusState(null, 7))).toEqual({});
  });

  it('holds only for the controller session that homed', () => {
    expect(focusMovedByHome(focusState(A1_PRO, 7, 7))).toBe(true);
    expect(focusMovedByHome(focusState(A1_PRO, 8, 7))).toBe(false);
    expect(focusMovedByHome(focusState(A1_PRO, 7, null))).toBe(false);
  });
});

describe('setting the height again', () => {
  const operation = { kind: 'jog' } as unknown as LaserMotionOperation;
  const homed = { ...focusState(A1_PRO, 3, 3) } as unknown as LaserState;

  it('a Z jog clears the reminder', () => {
    expect(jogStartPatch(homed, operation, { dz: 0.5 })).toMatchObject(FOCUS_SET_PATCH);
  });

  it('an XY jog leaves it standing', () => {
    expect(jogStartPatch(homed, operation, {})).not.toHaveProperty('focusMovedByHomeEpoch');
  });
});

describe('Job Review', () => {
  function warningsFor(machineKind: 'laser' | 'cnc', movedEpoch: number | null): string[] {
    if (machineKind === 'cnc') useStore.getState().setMachineKind('cnc');
    useLaserStore.setState({
      activeControllerCommandSet: A1_PRO,
      focusMovedByHomeEpoch: movedEpoch,
    });
    const { project } = useStore.getState();
    const laser = useLaserStore.getState();
    const snapshot = machineSnapshot(project, laser, useCameraStore.getState());
    return demotedPolicyWarnings(project, snapshot);
  }

  it('warns on a laser job after a Home that moved Z, as a warning only', () => {
    const epoch = useLaserStore.getState().controllerSessionEpoch;
    expect(warningsFor('laser', epoch)).toContain(HOME_MOVED_FOCUS_JOB_WARNING);
  });

  it('says nothing once the height is set again', () => {
    expect(warningsFor('laser', null)).not.toContain(HOME_MOVED_FOCUS_JOB_WARNING);
  });

  it('says nothing on a CNC job, whose Z zero has its own checks', () => {
    const epoch = useLaserStore.getState().controllerSessionEpoch;
    expect(warningsFor('cnc', epoch)).not.toContain(HOME_MOVED_FOCUS_JOB_WARNING);
  });
});
