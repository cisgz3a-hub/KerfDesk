import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGrblSimulator,
  createMarlinSimulator,
  createSmoothieSimulator,
} from '../../__fixtures__/controllers';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import type { ControllerKind } from '../../core/devices';
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
import { startTestLaserJobOnClock as startThroughSimulator } from '../state/laser-test-command-control';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import type * as OutputPreparationWorker from './output-preparation-worker-client';
import {
  expectCompletedCncStartPermit,
  expectG92DatumPreserved,
  withCncCompletionZDrift,
  withSmoothieInchReports,
} from './frame-after-completed-coordinate.test-support';
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

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetStore();
  useLaserStore.setState(initialLaserState());
  useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

function lineProject(controllerKind: ControllerKind): Project {
  const base = createProject();
  return {
    ...base,
    device: {
      ...base.device,
      controllerKind,
      origin: 'front-left',
      homing: { ...base.device.homing, enabled: false },
      maxPowerS: controllerKind === 'smoothieware' ? 1 : 1000,
    },
    scene: {
      ...EMPTY_SCENE,
      layers: [{ ...createLayer({ id: 'line', color: '#ff0000' }), power: 10 }],
      objects: [
        {
          kind: 'imported-svg',
          id: 'new-job',
          source: 'new-job.svg',
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

async function runFrame(): Promise<boolean> {
  const pending = runFrameNow();
  await vi.advanceTimersByTimeAsync(30_000);
  return pending;
}

describe('new Frame after prior completed output: coordinate/protocol audit', () => {
  it.each(['grbl-v1.1', 'grblhal', 'fluidnc', 'marlin', 'smoothieware'] as const)(
    '%s frames the new Current Position job from the settled end of the previous job',
    async (kind) => {
      const project = lineProject(kind);
      useStore.setState({
        project,
        jobPlacement: { startFrom: 'current-position', anchor: 'front-left' },
      });
      const sim =
        kind === 'marlin'
          ? createMarlinSimulator({ motionMs: 25 })
          : kind === 'smoothieware'
            ? createSmoothieSimulator({ motionMs: 25 })
            : createGrblSimulator({
                motionMs: 25,
                settings: [
                  [22, '0'],
                  [32, '1'],
                ],
              });
      await useLaserStore.getState().connect(sim.adapter, connectOptionsForDevice(project.device));
      await vi.advanceTimersByTimeAsync(2_000);
      await startThroughSimulator('G21\nG90\nG0 X75 Y45\nM5\nG91\n', {
        streamingMode: 'ping-pong',
      });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(useLaserStore.getState().streamer).toBeNull();
      const position = () => {
        const state = sim.state();
        return 'mpos' in state ? state.mpos : state.pos;
      };
      expect(position()).toMatchObject({ x: 75, y: 45 });

      expect(await runFrame(), JSON.stringify(useToastStore.getState().toasts)).toBe(true);

      const permit = useLaserStore.getState().framedRun;
      expect(permit?.candidate.preparedStart.jobOrigin).toMatchObject({
        startFrom: 'current-position',
        currentPosition: { x: 75, y: 45 },
      });
      expect(permit?.candidate.returnToWorkPosition).toEqual({ x: 75, y: 45 });
      expect(permit?.candidate.preparedStart.metrics.motionBounds).toMatchObject({
        minX: 75,
        maxX: 95,
        minY: 45,
        maxY: 65,
      });
      expect(position()).toMatchObject({ x: 75, y: 45 });
    },
  );

  it.each(
    (['grbl-v1.1', 'marlin', 'smoothieware'] as const).flatMap((kind) =>
      (['absolute', 'user-origin', 'verified-origin', 'current-position'] as const).map((mode) => ({
        kind,
        mode,
      })),
    ),
  )(
    '$kind keeps a nonzero work offset exactly once when the next job uses $mode',
    async ({ kind, mode }) => {
      const project = lineProject(kind);
      useStore.setState({ project, jobPlacement: { startFrom: mode, anchor: 'front-left' } });
      const sim =
        kind === 'marlin'
          ? createMarlinSimulator({ motionMs: 25 })
          : kind === 'smoothieware'
            ? createSmoothieSimulator({ motionMs: 25 })
            : createGrblSimulator({
                motionMs: 25,
                settings: [
                  [22, '0'],
                  [32, '1'],
                ],
              });
      await useLaserStore.getState().connect(sim.adapter, connectOptionsForDevice(project.device));
      await vi.advanceTimersByTimeAsync(2_000);
      const jogging = useLaserStore.getState().jog({ dx: 100, dy: 50, feed: 1000 });
      await vi.advanceTimersByTimeAsync(2_000);
      await jogging;
      const settingOrigin = useLaserStore.getState().setOriginHere();
      await vi.advanceTimersByTimeAsync(2_000);
      await settingOrigin;
      await startThroughSimulator('G21\nG90\nG0 X75 Y45\nM5\nG91\n', {
        streamingMode: 'ping-pong',
      });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(useLaserStore.getState().streamer).toBeNull();
      expect(useLaserStore.getState().wcoCache).toEqual({ x: 100, y: 50, z: 0 });
      const before = sim.outbound().length;

      expect(await runFrame(), JSON.stringify(useToastStore.getState().toasts)).toBe(true);

      const xy = sim
        .outbound()
        .slice(before)
        .flatMap((data) => data.split('\n'))
        .flatMap((line) => {
          const match = /^(?:\$J=G90 G21|G0) X(-?[\d.]+) Y(-?[\d.]+)/.exec(line);
          return match === null ? [] : [{ x: Number(match[1]), y: Number(match[2]) }];
        });
      // Independent physical-space targets: front-left profile flips scene Y.
      // Absolute reaches the canvas rectangle (10..30, bedHeight-40..-20).
      // User/Verified reaches work zero at native100,50. Current Position reaches
      // the prior job's settled native175,95. Subtract WCO only at the wire seam.
      const physicalMinimum =
        mode === 'absolute'
          ? { x: 10, y: project.device.bedHeight - 40 }
          : mode === 'current-position'
            ? { x: 175, y: 95 }
            : { x: 100, y: 50 };
      const physicalCorners = [
        physicalMinimum,
        { x: physicalMinimum.x + 20, y: physicalMinimum.y },
        { x: physicalMinimum.x + 20, y: physicalMinimum.y + 20 },
        { x: physicalMinimum.x, y: physicalMinimum.y + 20 },
        physicalMinimum,
      ];
      expect(xy.slice(0, 5)).toEqual(physicalCorners.map((p) => ({ x: p.x - 100, y: p.y - 50 })));
      expect(xy.at(-1)).toEqual({ x: 75, y: 45 });
      expect(useLaserStore.getState().framedRun?.candidate.returnToWorkPosition).toEqual({
        x: 75,
        y: 45,
      });
    },
  );

  it('Smoothieware G20 after a completed prior job does not misplace the next head-relative Frame', async () => {
    const project = lineProject('smoothieware');
    useStore.setState({
      project,
      jobPlacement: { startFrom: 'current-position', anchor: 'front-left' },
    });
    const sim = createSmoothieSimulator({ motionMs: 25 });
    await useLaserStore
      .getState()
      .connect(withSmoothieInchReports(sim), connectOptionsForDevice(project.device));
    await vi.advanceTimersByTimeAsync(2_000);
    await startThroughSimulator('G21\nG90\nG0 X254 Y127\nM5\nG20\n', {
      streamingMode: 'ping-pong',
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(sim.state()).toMatchObject({ pos: { x: 254, y: 127 } });

    const framing = await runFrame();
    const trace = sim
      .outbound()
      .flatMap((payload) => payload.split('\n'))
      .filter((line) => /^G0 X/.test(line));
    // Independent physical arithmetic: Current Position is the actual 254,127mm
    // head, then a 20x20mm front-left anchored rectangle, then that same head.
    expect(
      trace.at(-1),
      JSON.stringify({
        framing,
        pos: sim.state().pos,
        error: useLaserStore.getState().lastWriteError,
        trace,
      }),
    ).toContain('X254.000 Y127.000');
    expect(framing, JSON.stringify(useToastStore.getState().toasts)).toBe(true);
    expect(sim.state()).toMatchObject({ pos: { x: 254, y: 127 } });
  });

  it.each(['user-origin', 'current-position'] as const)(
    'Smoothieware G20 keeps a nonzero G92 datum for the next %s job',
    async (mode) => {
      const project = lineProject('smoothieware');
      useStore.setState({ project, jobPlacement: { startFrom: mode, anchor: 'front-left' } });
      const sim = createSmoothieSimulator({ motionMs: 25 });
      await useLaserStore
        .getState()
        .connect(withSmoothieInchReports(sim), connectOptionsForDevice(project.device));
      await vi.advanceTimersByTimeAsync(2_000);
      const jogging = useLaserStore.getState().jog({ dx: 127, dy: 50.8, feed: 1000 });
      await vi.advanceTimersByTimeAsync(2_000);
      await jogging;
      const origin = useLaserStore.getState().setOriginHere();
      await vi.advanceTimersByTimeAsync(2_000);
      await origin;
      await startThroughSimulator('G21\nG90\nG0 X127 Y76.2\nM5\nG20\n', {
        streamingMode: 'ping-pong',
      });
      await vi.advanceTimersByTimeAsync(5_000);
      const before = useLaserStore.getState();
      expect(before.wcoCache).toEqual({ x: 5, y: 2, z: 0 });
      const outboundBefore = sim.outbound().length;

      expect(await runFrame(), JSON.stringify(useToastStore.getState().toasts)).toBe(true);

      const after = useLaserStore.getState();
      expectG92DatumPreserved(before, after);
      const moves = sim
        .outbound()
        .slice(outboundBefore)
        .flatMap((data) => data.split('\n'))
        .filter((line) => /^G0 X/.test(line));
      expect(moves[0]).toContain(
        mode === 'current-position' ? 'X127.000 Y76.200' : 'X0.000 Y0.000',
      );
      expect(moves.at(-1)).toContain('X127.000 Y76.200');
      // Native = work + WCO, applied exactly once: 127+127, 76.2+50.8.
      expect(sim.state().pos).toEqual({ x: 254, y: 127, z: 0 });
    },
  );

  it.each([false, true])(
    'a CNC Frame beginning below stock zero stays retracted with unexpected Z drift: %s',
    async (drift) => {
      const project = lineProject('grbl-v1.1');
      useStore.setState({ project });
      useStore.getState().setMachineKind('cnc');
      const sim = createGrblSimulator({
        motionMs: 25,
        settings: [
          [22, '0'],
          [32, '0'],
        ],
      });
      await useLaserStore
        .getState()
        .connect(
          drift ? withCncCompletionZDrift(sim) : sim.adapter,
          connectOptionsForDevice(project.device),
        );
      await vi.advanceTimersByTimeAsync(2_000);
      const positioning = useLaserStore.getState().jog({ dx: 12, dy: 17, feed: 1000 });
      await vi.advanceTimersByTimeAsync(2_000);
      await positioning;
      const zeroing = useLaserStore.getState().zeroZHere();
      await vi.advanceTimersByTimeAsync(2_000);
      await zeroing;
      const lowering = useLaserStore.getState().jog({ dz: -1, feed: 500 });
      await vi.advanceTimersByTimeAsync(2_000);
      await lowering;
      const cncProject = useStore.getState().project;
      const safeZ =
        cncProject.machine?.kind === 'cnc' ? cncProject.machine.params.safeZMm : Number.NaN;
      expect(await runFrame(), JSON.stringify(useToastStore.getState().toasts)).toBe(!drift);
      // CNC compensation's first corner differs by one serialization tick. The
      // existing return planner omits a move within 0.001mm of that corner.
      expect(Math.abs(sim.state().mpos.x - 12)).toBeLessThanOrEqual(0.001 + Number.EPSILON * 12);
      expect(sim.state()).toMatchObject({ mpos: { y: 17, z: safeZ } });
      expect(useLaserStore.getState().motionOperation).toBeNull();
      const completed = useLaserStore.getState();
      const permit = completed.framedRun;
      if (drift) {
        expect(permit).toBeNull();
        expect(completed.lastWriteError).toContain('did not return');
        return;
      }
      expectCompletedCncStartPermit(cncProject, safeZ, completed);
    },
  );
});
