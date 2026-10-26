// Controller audit v2 C6-P2-2 (ADR-395 Amendment 1). Marlin built with
// NO_MOTION_BEFORE_HOMING skips every G0-G3 while an axis is unhomed: it echoes
// `echo:Home XYZ First` and still answers the line `ok` (motion.h L461-L465,
// G0_G1.cpp L48, motion.cpp L1479-L1496, gcode.cpp L1122). A stopped Marlin
// prints "Printer stopped due to errors..." for each move it reads and skips it
// the same way (queue.cpp L523-L535). KerfDesk took the echo for a message and
// the `ok` for success: a Frame whose moves were all skipped ended where it
// began, counted as completed and unlocked Start, and a job ran its M106 power
// at the parked head of a fan-wired laser.
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/motion.cpp#L1479-L1496
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/queue.cpp#L523-L535

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMarlinSimulator,
  type CreateMarlinSimulatorOptions,
  type MarlinSimulator,
} from '../../__fixtures__/controllers';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { connectOptionsForDevice } from '../commands/connect-options';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { startTestLaserJob } from '../state/laser-test-start-helpers';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import type * as OutputPreparationWorker from './output-preparation-worker-client';
import { runFrameNow } from './use-frame-action';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));
vi.mock('./output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputPreparationWorker>()),
  prepareStartOutputOffThread: async (
    request: Parameters<typeof prepareOutputRequestForTest>[0],
  ) => {
    const response = await prepareOutputRequestForTest(request);
    if (response.kind !== 'start') throw new Error('Expected start preparation');
    return response.result;
  },
}));

const STOPPED =
  'Printer stopped due to errors. Fix the error and use M999 to restart. ' +
  '(Temperature is reset. Set it after restarting)';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  localStorage.clear();
  resetStore();
  useLaserStore.setState(initialLaserState());
  useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
  const disconnecting = useLaserStore.getState().disconnect();
  await vi.advanceTimersByTimeAsync(5_000);
  await disconnecting;
  vi.useRealTimers();
  resetStore();
  vi.restoreAllMocks();
});

function lineProject(): Project {
  const base = createProject();
  return {
    ...base,
    device: {
      ...base.device,
      controllerKind: 'marlin',
      origin: 'front-left',
      homing: { ...base.device.homing, enabled: false },
      maxPowerS: 1000,
    },
    scene: {
      ...EMPTY_SCENE,
      layers: [{ ...createLayer({ id: 'line', color: '#ff0000' }), power: 10 }],
      objects: [
        {
          kind: 'imported-svg',
          id: 'job',
          source: 'job.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 10, minY: 20, maxX: 30, maxY: 40 },
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: true,
                  points: [
                    { x: 10, y: 20 },
                    { x: 30, y: 20 },
                    { x: 30, y: 40 },
                    { x: 10, y: 40 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

async function connect(options: CreateMarlinSimulatorOptions): Promise<MarlinSimulator> {
  const project = lineProject();
  useStore.setState({
    project,
    jobPlacement: { startFrom: 'current-position', anchor: 'front-left' },
  });
  const sim = createMarlinSimulator({ motionMs: 25, ...options });
  await useLaserStore.getState().connect(sim.adapter, connectOptionsForDevice(project.device));
  await vi.advanceTimersByTimeAsync(2_000);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

function connectNoMotionBeforeHoming(): Promise<MarlinSimulator> {
  return connect({ build: { noMotionBeforeHoming: true } });
}

async function runFrame(): Promise<boolean> {
  const pending = runFrameNow();
  await vi.advanceTimersByTimeAsync(30_000);
  return pending;
}

async function settle<T>(pending: Promise<T>, ms = 5_000): Promise<T> {
  await vi.advanceTimersByTimeAsync(ms);
  return pending;
}

function frameLegs(sim: MarlinSimulator, from = 0): ReadonlyArray<string> {
  return sim
    .outbound()
    .slice(from)
    .filter((write) => write.startsWith('G0 X'));
}

function expectFrameNotCompleted(): void {
  const laser = useLaserStore.getState();
  expect(laser.framedRun).toBeNull();
  expect(laser.completedFrame).toBeNull();
  expect(laser.frameTrace).toBeNull();
  expect(laser.frameVerification).toBeNull();
}

describe('a Frame on Marlin that skips moves until it is homed', () => {
  it('does not count as completed when the controller skipped its first move', async () => {
    const sim = await connectNoMotionBeforeHoming();

    await runFrame();

    expect(sim.state().pos).toEqual({ x: 0, y: 0, z: 0 });
    expectFrameNotCompleted();
    // The Frame stopped at the skipped leg instead of sending the rest.
    expect(frameLegs(sim)).toHaveLength(1);
    const notice = useLaserStore.getState().safetyNotice;
    expect(notice).toMatchObject({ kind: 'controller-error', raw: 'echo:Home XYZ First' });
    expect(notice?.message).toContain('until X, Y and Z are homed');
    expect(notice?.message).toContain('KerfDesk stopped the Frame');
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });

  it("names Z after KerfDesk's Home, which homes X and Y only", async () => {
    const sim = await connectNoMotionBeforeHoming();
    await settle(useLaserStore.getState().home());
    expect(sim.state().homedAxes).toBe('XY');

    await runFrame();

    expectFrameNotCompleted();
    const message = useLaserStore.getState().safetyNotice?.message;
    expect(message).toContain('until Z is homed ("Home Z First"');
    expect(message).toContain('from the Console (G28 Z)');
  });

  it('completes once every axis is homed (control)', async () => {
    const sim = await connectNoMotionBeforeHoming();
    await settle(useLaserStore.getState().sendConsoleCommand('G28'));
    expect(sim.state().homedAxes).toBe('XYZ');

    expect(await runFrame(), JSON.stringify(useToastStore.getState().toasts)).toBe(true);

    expect(frameLegs(sim)).toHaveLength(5);
    expect(useLaserStore.getState().framedRun).not.toBeNull();
    expect(useLaserStore.getState().safetyNotice).toBeNull();
  });
});

describe('a job on Marlin that skips moves until it is homed', () => {
  it('stops at the skipped move, before the M106 that would light a fan-wired laser', async () => {
    const sim = await connectNoMotionBeforeHoming();

    await startTestLaserJob('G0 X10 Y10\nM106 S255\nG1 X20 F600\nM107\n', {
      streamingMode: 'ping-pong',
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(useLaserStore.getState().streamer?.status).toBe('errored');
    await vi.advanceTimersByTimeAsync(3_000);

    expect(sim.outbound()).toContain('G0 X10 Y10\n');
    expect(sim.outbound()).not.toContain('M106 S255\n');
    expect(sim.state().fanPower).toBe(0);
    expect(sim.state().burns).toEqual([]);
    const laser = useLaserStore.getState();
    expect(laser.liveCanvasRun?.timing ?? null).not.toMatchObject({ kind: 'complete' });
    expect(laser.safetyNotice).toMatchObject({
      kind: 'controller-error',
      rejectedLine: 'G0 X10 Y10',
    });
    expect(laser.safetyNotice?.message).toContain('KerfDesk stopped the job');
    // The ordinary stream-error stop went out as well.
    expect(sim.outbound()).toEqual(expect.arrayContaining(['M107\n', 'M410\n', 'M5 I\n']));
  });
});

describe('a jog on Marlin that skips moves until it is homed', () => {
  it('stops with the reason instead of finishing quietly', async () => {
    const sim = await connectNoMotionBeforeHoming();

    await settle(
      useLaserStore
        .getState()
        .jog({ dx: 10, dy: 0, feed: 1000 })
        .catch(() => undefined),
    );

    expect(sim.state().pos).toEqual({ x: 0, y: 0, z: 0 });
    expect(useLaserStore.getState().safetyNotice?.message).toContain('KerfDesk stopped the jog');
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });
});

describe('a Frame on a stopped Marlin', () => {
  it('does not count as completed and says how to restart the controller', async () => {
    const sim = await connect({});
    // stop() after a firmware error announces itself once as an Error:.
    sim.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(useLaserStore.getState().safetyNotice?.message).toContain('M999 S1');
    // The operator closes that notice and Frames anyway.
    useLaserStore.getState().clearSafetyNotice();

    await runFrame();

    expect(sim.state().pos).toEqual({ x: 0, y: 0, z: 0 });
    expectFrameNotCompleted();
    expect(frameLegs(sim)).toHaveLength(1);
    const notice = useLaserStore.getState().safetyNotice;
    expect(notice).toMatchObject({ kind: 'controller-error', raw: STOPPED });
    expect(notice?.message).toContain('stopped after a firmware error');
    expect(notice?.message).toContain('KerfDesk stopped the Frame');
    expect(notice?.message).toContain('M999 S1');
  });
});
