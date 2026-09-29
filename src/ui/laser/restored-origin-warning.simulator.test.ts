// Job Review names a work origin the controller already had when KerfDesk
// connected, when a User Origin job runs from it before the machine is homed
// (controller audit 2, M-4, ADR-375). grblHAL keeps Set origin here (G92)
// through a reset and, unless `$384=1`, saves it and restores it at power-up;
// every GRBL-family controller keeps a saved G54. Machine position restarts
// wherever the head stands at power-up, so without Home that origin need not
// be where it was set. A warning, never a refusal (PROJECT.md NN21).
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/gcode.c#L787
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/gcode.c#L833-L838

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { disconnectOnTestClock } from '../state/laser-disconnect-testing';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { prepareCurrentStartJob } from './start-job-source';

const GRBL_HAL_BANNER = "GrblHAL 1.1f ['$' or '$HELP' for help]";
const USER_ORIGIN = { startFrom: 'user-origin', anchor: 'front-left' } as const;
const RESTORED = 'already on the controller when KerfDesk connected';
const SAVED = { x: 25, y: 15, z: 0 };

function lineProject(): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [
        {
          kind: 'imported-svg',
          id: 'O1',
          source: 'a.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  points: [
                    { x: 1, y: 1 },
                    { x: 9, y: 9 },
                  ],
                  closed: false,
                },
              ],
            },
          ],
        },
      ],
      layers: [createLayer({ id: 'L1', color: '#ff0000' })],
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  resetStore();
  useStore.setState({ project: lineProject(), jobPlacement: USER_ORIGIN });
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
    homingState: 'unknown',
    workOriginActive: false,
    workOriginSource: 'none',
    wcoCache: null,
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pump(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

// Advances the test clock until the action settles, and fails if it does not.
async function settle(action: Promise<unknown>, withinMs = 1_000): Promise<void> {
  let settled = false;
  const outcome = action.then(
    () => null,
    (error: unknown) => error,
  );
  void outcome.then(() => {
    settled = true;
  });
  for (let waited = 0; !settled && waited < withinMs; waited += 100) await pump(100);
  expect(settled).toBe(true);
  const error = await outcome;
  if (error !== null) throw error;
}

async function connect(sim: GrblSimulator, controllerKind: 'grblhal' | 'grbl-v1.1') {
  await useLaserStore.getState().connect(sim.adapter, { controllerKind });
  await pump(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
}

// What the Start preparation's Job Review warns, once the controller has
// reported its work offset (every 10th Idle report at the latest).
async function userOriginWarnings(): Promise<string> {
  await pump(3_000);
  const prepared = await prepareCurrentStartJob(
    useStore.getState(),
    useLaserStore.getState(),
    useCameraStore.getState(),
    undefined,
    false,
  );
  if (!prepared.ok) throw new Error(prepared.messages.join('\n'));
  return prepared.warnings.join('\n');
}

function grblHalWithStoredG92(): GrblSimulator {
  return createGrblSimulator({
    firmware: 'grblhal',
    firmwareBanner: GRBL_HAL_BANNER,
    settings: [[384, '0']],
    storedOffsets: { g92: SAVED },
  });
}

describe('an origin the controller already had when KerfDesk connected', () => {
  it('grblHAL: warns, naming $384, until Set origin here replaces it', async () => {
    const sim = grblHalWithStoredG92();
    expect(sim.state()).toMatchObject({ g92: SAVED, mpos: { x: 0, y: 0, z: 0 } });
    await connect(sim, 'grblhal');
    const warnings = await userOriginWarnings();
    expect(warnings).toContain(RESTORED);
    expect(warnings).toContain('keeps Set origin here through a power cycle ($384=0)');

    await settle(useLaserStore.getState().setOriginHere());
    expect(await userOriginWarnings()).not.toContain(RESTORED);
  });

  it('grblHAL: stays quiet once the machine is homed', async () => {
    await connect(grblHalWithStoredG92(), 'grblhal');
    expect(await userOriginWarnings()).toContain(RESTORED);

    await settle(useLaserStore.getState().home(), 10_000);
    expect(useLaserStore.getState().homingState).toBe('confirmed');
    expect(await userOriginWarnings()).not.toContain(RESTORED);
  });

  it('grblHAL: a reset within the session leaves an origin set in it unnamed', async () => {
    const sim = createGrblSimulator({ firmware: 'grblhal', firmwareBanner: GRBL_HAL_BANNER });
    await connect(sim, 'grblhal');
    await settle(useLaserStore.getState().jog({ dx: 25, dy: 15, feed: 1_000 }), 2_000);
    await pump(2_000);
    await settle(useLaserStore.getState().setOriginHere());
    await settle(useLaserStore.getState().stopJob(), 3_000);
    expect(sim.outbound()).toContain('\x18');
    // grblHAL kept the G92 (gcode.c:787); the next report brings it back.
    await pump(3_000);
    expect(useLaserStore.getState()).toMatchObject({
      workOriginActive: true,
      workOriginSource: 'unknown',
      wcoCache: SAVED,
    });
    expect(await userOriginWarnings()).not.toContain(RESTORED);
  });

  it('stock GRBL: warns about a saved G54 origin', async () => {
    const sim = createGrblSimulator({ storedOffsets: { g54: SAVED, g92: { x: 5, y: 5, z: 0 } } });
    // Stock GRBL keeps no G92 across a power cycle (gcode.c gc_init).
    expect(sim.state()).toMatchObject({ g54: SAVED, g92: null });
    await connect(sim, 'grbl-v1.1');
    const warnings = await userOriginWarnings();
    expect(warnings).toContain(RESTORED);
    expect(warnings).toContain('A saved G54 origin survives a power cycle.');
  });
});
