// Momentary Fire against GRBL's laser-mode modal rule. Every byte fed to the
// oracle is produced by real KerfDesk code (job emission, the drivers' home,
// jog and frame builders, and the Fire press itself); the oracle is an
// independent port of gnea/grbl gcode.c's laser-power logic.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeGrblLine,
  powerUpGrbl,
  runGrblLines,
  type GrblLaserPowerModel,
} from '../../__fixtures__/controllers/grbl-laser-power-model';
import { selectControllerDriver } from '../../core/controllers';
import type { DeviceProfile } from '../../core/devices';
import {
  FALCON_A1_PRO_GRBLHAL_PROFILE,
  FALCON_COMPATIBLE_PROFILE,
} from '../../core/devices/falcon-profiles';
import type { Job } from '../../core/job';
import { grblStrategy } from '../../core/output/grbl-strategy';
import { useExperimentalLaserFeatures } from './experimental-laser-features';
import { fireActions } from './laser-fire-actions';
import { useLaserStore, type LaserState } from './laser-store';
import { useStore } from './store';

// 2% of the profiles' S1000 range.
const FIRE_PERCENT = 2;
const EXPECTED_FIRE_POWER = 20;

const JOB: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#000000',
      power: 30,
      speed: 1000,
      passes: 1,
      airAssist: false,
      segments: [
        {
          closed: false,
          polyline: [
            { x: 10, y: 10 },
            { x: 40, y: 10 },
          ],
        },
      ],
    },
  ],
};

const originalProject = useStore.getState().project;

function useProfile(device: DeviceProfile): void {
  useStore.setState({
    project: {
      ...originalProject,
      machine: { kind: 'laser' },
      device: { ...device, fireControl: { enabled: true, maxPowerPercent: FIRE_PERCENT } },
    },
  });
}

async function fireBytes(active: boolean, from: LaserState): Promise<{
  readonly bytes: string;
  readonly state: LaserState;
}> {
  let state = from;
  const set = (
    partial: Partial<LaserState> | ((current: LaserState) => Partial<LaserState> | LaserState),
  ): void => {
    state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
  };
  const writes: string[] = [];
  const write = vi.fn(async (line: string) => {
    writes.push(line);
  });
  await fireActions(set, () => state, write).setFireActive(active, FIRE_PERCENT);
  return { bytes: writes.join(''), state };
}

function idleConnectedState(): LaserState {
  return {
    ...useLaserStore.getState(),
    connection: { kind: 'connected' },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
      pins: null,
      ov: null,
    },
    capabilities: { ...useLaserStore.getState().capabilities, lowPowerFire: true },
    alarmCode: null,
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
    autofocusBusy: false,
    probeBusy: false,
    pendingUntrackedAcks: 0,
    fireActive: false,
  };
}

async function pressFire(model: GrblLaserPowerModel): Promise<LaserState> {
  const press = await fireBytes(true, idleConnectedState());
  runGrblLines(model, press.bytes);
  return press.state;
}

beforeEach(() => {
  useExperimentalLaserFeatures.getState().resetFeatures();
  useExperimentalLaserFeatures.getState().setFeature('lowPowerFire', true);
});

afterEach(() => {
  useStore.setState({ project: originalProject });
  useExperimentalLaserFeatures.getState().resetFeatures();
});

describe('momentary Fire and the GRBL laser-mode modal state', () => {
  it('oracle sanity: a bare M3 is dark from G0 in laser mode and lit with $32=0', () => {
    expect(runGrblLines(powerUpGrbl(false), 'M3 S20').beam).toBe(20);
    expect(runGrblLines(powerUpGrbl(true), 'M3 S20').beam).toBe(0);
    expect(runGrblLines(powerUpGrbl(true), 'G1 M3 S20').errors).toHaveLength(1);
  });

  it('lights the beam from the G0 state a controller starts in after connect or reset', async () => {
    useProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
    const model = powerUpGrbl(true);

    const state = await pressFire(model);

    expect(state.fireActive).toBe(true);
    expect(model.errors).toEqual([]);
    expect(model.beam).toBe(EXPECTED_FIRE_POWER);
  });

  it('lights the beam right after a completed Falcon job, whose park leaves G0 modal', async () => {
    useProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
    const model = runGrblLines(powerUpGrbl(true), grblStrategy.emit(JOB, FALCON_A1_PRO_GRBLHAL_PROFILE));
    expect(model.motion).toBe('G0');

    await pressFire(model);

    expect(model.errors).toEqual([]);
    expect(model.beam).toBe(EXPECTED_FIRE_POWER);
  });

  it('lights the beam after Home on the Falcon A1 Pro command set', async () => {
    useProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
    const driver = selectControllerDriver('grblhal', 'creality-falcon-a1-pro');
    const model = runGrblLines(powerUpGrbl(true), driver.commands.home ?? '');

    await pressFire(model);

    expect(model.beam).toBe(EXPECTED_FIRE_POWER);
  });

  it('lights the beam after a generic GRBL $J jog and frame, which never leave G0', async () => {
    useProfile(FALCON_COMPATIBLE_PROFILE);
    const driver = selectControllerDriver(
      'grbl-v1.1',
      FALCON_COMPATIBLE_PROFILE.controllerCommandSet,
    );
    const model = powerUpGrbl(true);
    runGrblLines(model, driver.commands.buildJog({ dx: 5, feed: 1000 }));
    runGrblLines(model, driver.commands.frameToolOffLines);
    runGrblLines(model, driver.commands.buildFrameLines({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000));

    await pressFire(model);

    expect(model.errors).toEqual([]);
    expect(model.beam).toBe(EXPECTED_FIRE_POWER);
  });

  it('goes dark on release', async () => {
    useProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
    const model = powerUpGrbl(true);
    const lit = await pressFire(model);
    expect(model.beam).toBe(EXPECTED_FIRE_POWER);

    const release = await fireBytes(false, lit);
    executeGrblLine(model, release.bytes);

    expect(release.state.fireActive).toBe(false);
    expect(model.errors).toEqual([]);
    expect(model.beam).toBe(0);
  });

  it('is an ordinary spindle-on when laser mode is off', async () => {
    useProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
    const model = powerUpGrbl(false);

    await pressFire(model);

    expect(model.errors).toEqual([]);
    expect(model.beam).toBe(EXPECTED_FIRE_POWER);
  });
});
