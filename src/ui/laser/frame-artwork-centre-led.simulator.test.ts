import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import { framedRunStartHandoffIssue } from '../state/framed-run';
import { inferCurrentMachinePosition } from '../state/infer-machine-position';
import { disconnectOnTestClock } from '../state/laser-disconnect-testing';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { prepareFramedStartReview } from './framed-start-preparation';
import {
  connectedFixture,
  expectProgramSentOnce,
  startReviewedFrameOnClock,
} from './frame-artwork-centre-led.test-support';
import type * as OutputPreparationWorker from './output-preparation-worker-client';
import { centreLightAfterCleanFrame, runFrameNow } from './use-frame-action';
import { centreLightOnFramedArtwork } from './centre-selection-light';

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
  await disconnectOnTestClock();
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const families = ['grbl-v1.1', 'grblhal', 'fluidnc', 'marlin', 'smoothieware'] as const;
const modes = ['absolute', 'user-origin', 'verified-origin', 'current-position'] as const;

describe('Frame followed by a separate LED at the placed output artwork centre', () => {
  it.each(['artwork', 'placement', 'output-scope', 'work-offset'] as const)(
    'cancels pending automatic centring after %s changes while M5 acknowledgement is held',
    async (drift) => {
      const { sim, frameAck } = await connectedFixture('grbl-v1.1', 'current-position');
      const framing = runFrameNow();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await framing).toBe(true);
      const from = sim.outbound().length;
      const before = useLaserStore.getState();
      const head = inferCurrentMachinePosition(before.statusReport, before.wcoCache);
      frameAck.arm();
      const centring = centreLightOnFramedArtwork();
      const outcome = centring.then(
        () => null,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(100);
      expect(frameAck.held()).toBe(true);
      expect(sim.outbound().slice(from).join('')).toContain('M5\n');
      if (drift === 'artwork')
        useStore.setState((app) => ({
          project: {
            ...app.project,
            scene: {
              ...app.project.scene,
              objects: app.project.scene.objects.map((object) => ({
                ...object,
                transform: { ...object.transform, x: object.transform.x + 1 },
              })),
            },
          },
        }));
      if (drift === 'placement')
        useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'center' } });
      if (drift === 'output-scope')
        useStore.setState({
          outputScopeSettings: { cutSelectedGraphics: true, useSelectionOrigin: false },
        });
      if (drift === 'work-offset') useLaserStore.setState({ wcoCache: { x: 101, y: 50, z: 0 } });
      frameAck.release();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await outcome).toBeInstanceOf(Error);
      expect(sim.outbound().slice(from).join('')).not.toMatch(/M7|\$J|G[01] /);
      const after = useLaserStore.getState();
      expect(inferCurrentMachinePosition(after.statusReport, after.wcoCache)).toEqual(head);
      expect(after.positioningLightEnabled).toBe(false);
    },
  );

  it.each(families.flatMap((kind) => modes.map((mode) => ({ kind, mode }))))(
    '$kind / $mode keeps the framed placement when moving the LED and preparing Start',
    async ({ kind, mode }) => {
      const { project, sim } = await connectedFixture(kind, mode);
      const firstWrite = sim.outbound().length;
      const operation = runFrameNow().then(async (accepted) => {
        expect(accepted, JSON.stringify(useToastStore.getState().toasts)).toBe(true);
        const beforeLight = useLaserStore.getState().framedRun;
        expect(beforeLight).not.toBeNull();
        await centreLightAfterCleanFrame(accepted);
        return {
          beforeLight: beforeLight!,
          diagnostics: {
            toasts: useToastStore.getState().toasts,
            error: useLaserStore.getState().lastWriteError,
            placement: useStore.getState().jobPlacement,
            light: useStore.getState().project.device.positioningLight,
          },
        };
      });
      await vi.advanceTimersByTimeAsync(30_000);
      const { beforeLight, diagnostics } = await operation;
      // Independent native-space arithmetic: the two output objects span
      // 50x30mm. Relative placements use work zero or captured work75,45.
      const centre =
        mode === 'absolute'
          ? { x: 55, y: project.device.bedHeight - 55 }
          : mode === 'current-position'
            ? { x: 200, y: 110 }
            : { x: 125, y: 65 };
      const laser = useLaserStore.getState();
      const native = inferCurrentMachinePosition(laser.statusReport, laser.wcoCache);
      // Canvas Y is flipped at a front-left origin: pointer(-4 canvas Y)
      // lies +4 native Y from the head, hence head Y is centre minus 4.
      expect(native, JSON.stringify(diagnostics)).toMatchObject({
        x: centre.x - 7,
        y: centre.y - 4,
      });
      expect(laser.positioningLightEnabled).toBe(true);
      const permit = laser.framedRun;
      expect(permit).not.toBeNull();
      expect(permit?.candidate).toBe(beforeLight.candidate);
      expect(framedRunStartHandoffIssue(permit!, laser)).toBeNull();
      const review = await prepareFramedStartReview(permit!);
      expect(review).not.toBeNull();
      expect(review?.prepared.jobOrigin).toEqual(beforeLight.candidate.preparedStart.jobOrigin);
      expect(review?.prepared.metrics.frameJobBounds).toEqual(
        beforeLight.candidate.preparedStart.metrics.frameJobBounds,
      );
      expect(review?.prepared.metrics.frameMotionBounds).toEqual(
        beforeLight.candidate.preparedStart.metrics.frameMotionBounds,
      );
      if (mode === 'current-position') {
        expect(review?.prepared.jobOrigin).toMatchObject({ currentPosition: { x: 75, y: 45 } });
      }
      const wire = sim.outbound().slice(firstWrite).join('');
      expect(wire).toContain('M7\n');
      expect(wire).not.toMatch(/\bM[34]\b/);
      expect(laser.lastWriteError).toBeNull();
    },
  );

  it('applies the LED offset in bed axes when both native axes are mirrored', async () => {
    const { project } = await connectedFixture('grbl-v1.1', 'absolute', 'front-right');
    const operation = runFrameNow().then(centreLightAfterCleanFrame);
    await vi.advanceTimersByTimeAsync(30_000);
    await operation;
    const laser = useLaserStore.getState();
    expect(inferCurrentMachinePosition(laser.statusReport, laser.wcoCache)).toMatchObject({
      x: project.device.bedWidth - 55 + 7,
      y: project.device.bedHeight - 55 - 4,
    });
    expect(laser.positioningLightEnabled).toBe(true);
  });

  it('Marlin reaches the same Absolute target after the final Frame status acknowledgement', async () => {
    const { project } = await connectedFixture('marlin', 'absolute');
    const framing = runFrameNow();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await framing).toBe(true);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    const centring = centreLightAfterCleanFrame(true);
    await vi.advanceTimersByTimeAsync(5_000);
    await centring;
    const laser = useLaserStore.getState();
    expect(inferCurrentMachinePosition(laser.statusReport, laser.wcoCache)).toMatchObject({
      x: 48,
      y: project.device.bedHeight - 59,
    });
    expect(laser.positioningLightEnabled).toBe(true);
    expect(laser.framedRun).not.toBeNull();
  });

  it('does not switch the LED on when Frame is cancelled before dispatch', async () => {
    const { sim } = await connectedFixture('grbl-v1.1', 'absolute');
    const from = sim.outbound().length;
    const abort = new AbortController();
    abort.abort();
    const operation = runFrameNow({ signal: abort.signal, interactiveSetup: false }).then(
      centreLightAfterCleanFrame,
    );
    const outcome = operation.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await outcome).toMatchObject({ name: 'AbortError' });
    expect(sim.outbound().slice(from).join('')).not.toContain('M7\n');
    expect(useLaserStore.getState().positioningLightEnabled).toBe(false);
    expect(useLaserStore.getState().framedRun).toBeNull();
  });

  it('waits for a held Marlin Frame ACK before starting the LED move', async () => {
    const { sim, frameAck } = await connectedFixture('marlin', 'absolute');
    frameAck.arm();
    const from = sim.outbound().length;
    const operation = runFrameNow().then(centreLightAfterCleanFrame);
    for (let tick = 0; tick < 500 && !frameAck.held(); tick++)
      await vi.advanceTimersByTimeAsync(10);
    expect(frameAck.held()).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(useLaserStore.getState().positioningLightEnabled).toBe(false);
    expect(sim.outbound().slice(from).join('')).not.toContain('M7\n');
    frameAck.release();
    await vi.advanceTimersByTimeAsync(5_000);
    await operation;
    expect(useLaserStore.getState().positioningLightEnabled).toBe(true);
    expect(useLaserStore.getState().framedRun).not.toBeNull();
  });

  it.each(families)(
    '%s Start streams the captured Current Position after the LED move',
    async (kind) => {
      const { sim } = await connectedFixture(kind, 'current-position');
      const framing = runFrameNow().then(centreLightAfterCleanFrame);
      await vi.advanceTimersByTimeAsync(30_000);
      await framing;
      const permit = useLaserStore.getState().framedRun;
      expect(permit).not.toBeNull();
      const review = await prepareFramedStartReview(permit!);
      expect(review?.prepared.jobOrigin).toMatchObject({ currentPosition: { x: 75, y: 45 } });
      expect(review?.prepared.metrics.frameJobBounds).toEqual({
        minX: 75,
        maxX: 125,
        minY: 45,
        maxY: 75,
      });
      const from = sim.outbound().length;
      const repository = await startReviewedFrameOnClock();
      expectProgramSentOnce(sim.outbound().slice(from), review!.prepared.gcode);
      const archive = repository.getSnapshot();
      // This store harness has no mounted application checkpoint tracker;
      // retain the archive's placement whether activation or completion won.
      expect((archive.lastCompletedReceipt ?? archive.activeRun)?.artifact.jobOrigin).toMatchObject(
        {
          startFrom: 'current-position',
          currentPosition: { x: 75, y: 45 },
        },
      );
      expect(useLaserStore.getState().framedRun).toBeNull();
      expect(useLaserStore.getState().framedRunStartClaim).toBeNull();
      expect(useLaserStore.getState().lastWriteError).toBeNull();
    },
  );

  it.each(['artwork-edit', 'jog', 'reset'] as const)(
    '%s after the LED move invalidates captured Current Position',
    async (drift) => {
      const { sim } = await connectedFixture('grbl-v1.1', 'current-position');
      const framing = runFrameNow().then(centreLightAfterCleanFrame);
      await vi.advanceTimersByTimeAsync(30_000);
      await framing;
      expect(useLaserStore.getState().framedRun).not.toBeNull();
      if (drift === 'artwork-edit') {
        const original = useStore.getState().project;
        useStore.setState({
          project: {
            ...original,
            scene: {
              ...original.scene,
              objects: original.scene.objects.map((object) => ({
                ...object,
                transform: { ...object.transform, x: object.transform.x + 1 },
              })),
            },
          },
        });
        useStore.setState({ project: original });
      } else {
        const movement =
          drift === 'jog'
            ? useLaserStore.getState().jog({ dx: 1, dy: 0, feed: 1000 })
            : useLaserStore.getState().stopJob();
        await vi.advanceTimersByTimeAsync(3_000);
        await movement;
      }
      expect(useLaserStore.getState().framedRun).toBeNull();
      expect(useLaserStore.getState().completedFrame).toBeNull();
      const from = sim.outbound().length;
      const repository = await startReviewedFrameOnClock();
      expect(sim.outbound().slice(from).join('')).not.toMatch(/\bM[34]\b/);
      expect(repository.getSnapshot().lastCompletedReceipt).toBeNull();
    },
  );
});
