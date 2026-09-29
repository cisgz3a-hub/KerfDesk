// Controller audit 2, M-1 (ADR-375): a failed probe, ALARM:4 or ALARM:5, stops
// only the probe move. GRBL resets nothing and `$X` only returns to Idle, so
// the controller still applies the operator's Set origin (G92) and reports the
// same position. KerfDesk forgot that origin at the alarm and stopped trusting
// the reported position at Unlock, so a missed touch-off cost the origin the
// machine still used. Driven through the real store against the GRBL simulator.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L273-L298
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L160-L165

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGrblSimulator,
  type CreateGrblSimulatorOptions,
  type GrblSimulator,
} from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { DEFAULT_Z_PROBE_PARAMS, type ProbeRequest } from '../../core/controllers/grbl/probe';
import { resolveJobPlacement } from '../job-placement';
import { disconnectOnTestClock } from './laser-disconnect-testing';
import { useLaserStore } from './laser-store';
import { resetStore } from './test-helpers';

const USER_ORIGIN = { startFrom: 'user-origin', anchor: 'front-left' } as const;
const CURRENT_POSITION = { startFrom: 'current-position', anchor: 'front-left' } as const;
const Z_REQUEST = { kind: 'z', params: DEFAULT_Z_PROBE_PARAMS } satisfies ProbeRequest;
const SET_ORIGIN = { x: 25, y: 15, z: 0 };
const GRBLHAL: CreateGrblSimulatorOptions = {
  firmware: 'grblhal',
  firmwareBanner: "GrblHAL 1.1f ['$' or '$HELP' for help]",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  resetStore();
});

afterEach(async () => {
  await disconnectOnTestClock();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    safetyNotice: null,
    alarmCode: null,
    lastWriteError: null,
    workOriginActive: false,
    workOriginSource: 'none',
    wcoCache: null,
    workZZeroEvidence: null,
    positionEvidenceSuppressed: false,
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Advances the test clock until `promise` settles. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => {
    done = true;
  });
  for (let tick = 0; tick < 600 && !done; tick += 1) await vi.advanceTimersByTimeAsync(10);
  return tracked;
}

/** Connects, jogs to (25, 15) and sets the origin there: G92 X25 Y15. */
async function connectWithSetOrigin(
  options: CreateGrblSimulatorOptions = {},
): Promise<GrblSimulator> {
  const sim = createGrblSimulator(options);
  const controllerKind = options.firmware === 'grblhal' ? 'grblhal' : 'grbl-v1.1';
  await useLaserStore.getState().connect(sim.adapter, { controllerKind });
  await vi.advanceTimersByTimeAsync(1_200);
  await settle(useLaserStore.getState().jog({ dx: 25, dy: 15, feed: 1_000 }));
  await vi.advanceTimersByTimeAsync(1_000);
  await settle(useLaserStore.getState().setOriginHere());
  await vi.advanceTimersByTimeAsync(1_000);
  expect(sim.state().g92).toEqual(SET_ORIGIN);
  expect(useLaserStore.getState()).toMatchObject({ workOriginSource: 'g92', wcoCache: SET_ORIGIN });
  return sim;
}

async function unlock(): Promise<void> {
  await settle(useLaserStore.getState().unlockAlarm());
  await vi.advanceTimersByTimeAsync(3_000);
}

describe('a failed probe keeps the Set origin (M-1)', () => {
  it.each([4, 5] as const)('a Z touch-off that fails with ALARM:%i, then Unlock', async (code) => {
    const sim = await connectWithSetOrigin({ probeFailure: code });

    await expect(settle(useLaserStore.getState().probe(Z_REQUEST))).resolves.toEqual({
      kind: 'probe-failed',
      alarmCode: code,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    // Neither the ALARM line nor the Alarm reports after it drop the origin.
    expect(useLaserStore.getState()).toMatchObject({
      alarmCode: code,
      workOriginActive: true,
      workOriginSource: 'g92',
    });

    await unlock();
    expect(sim.state().g92).toEqual(SET_ORIGIN);
    const laser = useLaserStore.getState();
    expect(laser).toMatchObject({
      alarmCode: null,
      workOriginActive: true,
      workOriginSource: 'g92',
      positionEvidenceSuppressed: false,
      wcoCache: SET_ORIGIN,
      workZZeroEvidence: null,
    });
    expect(laser.statusReport?.mPos).not.toBeNull();
    expect(resolveJobPlacement(USER_ORIGIN, laser)).toMatchObject({
      ok: true,
      preflightMotionOffset: { x: 25, y: 15 },
    });
    expect(resolveJobPlacement(CURRENT_POSITION, laser).ok).toBe(true);
  });

  // Stock GRBL raises every other alarm with a reset; grblHAL's ALARM:13 (probe
  // protection) may lose steps (probe-failure-alarm.ts). Both still withhold
  // the position until Home or Set origin here.
  it.each([
    ['stock GRBL ALARM:3', {}, 3],
    ['grblHAL ALARM:13', GRBLHAL, 13],
  ] as const)(
    'any other alarm still withholds the position after Unlock: %s',
    async (_, options, code) => {
      const sim = await connectWithSetOrigin(options);
      sim.triggerAlarm(code);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(useLaserStore.getState().alarmCode).toBe(code);

      await unlock();
      expect(useLaserStore.getState()).toMatchObject({
        alarmCode: null,
        workOriginActive: false,
        workOriginSource: 'none',
        positionEvidenceSuppressed: true,
        wcoCache: null,
      });
    },
  );
});
