import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import {
  executeGrblLine,
  powerUpGrbl,
} from '../../__fixtures__/controllers/grbl-laser-power-model';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { IDENTITY_TRANSFORM, LAYER_DEFAULTS, type ImportedSvg } from '../../core/scene';
import { connectOptionsForDevice } from '../commands/connect-options';
import { dismissCompletedJobDisplay } from '../state/completed-job-display';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { frameOnceRepository } from './frame-once.test-support';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import type * as OutputPreparationWorker from './output-preparation-worker-client';
import { runFramedPermitStart, runStartJobFlow } from './start-job-flow';
import { runFrameNow } from './use-frame-action';
import { runJobStartMarkNow, useJobStartMarkPreparation } from './use-job-start-mark';
import { installJobShortcuts } from './use-job-shortcuts';

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
    if (response.kind !== 'start') throw new Error('Expected start preparation.');
    return response.result;
  },
}));

let uninstallReview = (): void => undefined;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetStore();
  useLaserStore.setState(initialLaserState());
  useToastStore.setState({ toasts: [] });
  useJobReviewStore.getState().close();
  useJobStartMarkPreparation.setState({ pending: false });
  useExperimentalLaserFeatures.getState().setFeature('lowPowerFire', true);
  uninstallReview = installAutoJobReview('confirm');
});

afterEach(async () => {
  uninstallReview();
  useJobReviewStore.getState().close();
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  useExperimentalLaserFeatures.getState().resetFeatures();
  resetStore();
  vi.restoreAllMocks();
});

function rectangle(id: string, x: number, y: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: x, minY: y, maxX: x + 8, maxY: y + 8 },
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x, y },
              { x: x + 8, y },
              { x: x + 8, y: y + 8 },
              { x, y: y + 8 },
              { x, y },
            ],
          },
        ],
      },
    ],
  };
}

async function onClock<T>(promise: Promise<T>, timeoutMs = 30_000): Promise<T> {
  let done = false;
  const outcome = promise
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    .finally(() => {
      done = true;
    });
  for (let ms = 0; ms < timeoutMs && !done; ms += 25) await vi.advanceTimersByTimeAsync(25);
  expect(done, JSON.stringify(useToastStore.getState().toasts)).toBe(true);
  const result = await outcome;
  if (!result.ok) throw result.error;
  return result.value;
}

async function connected(profileS: number, controllerS: number): Promise<GrblSimulator> {
  useStore.getState().replaceDeviceProfile({
    ...DEFAULT_DEVICE_PROFILE,
    name: 'Lifecycle audit machine',
    origin: 'front-left',
    homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: false },
    streamingMode: 'ping-pong',
    maxPowerS: profileS,
    framingFeedMmPerMin: 1000,
    capabilities: [...(DEFAULT_DEVICE_PROFILE.capabilities ?? []), 'low-power-fire'],
    fireControl: { enabled: true, maxPowerPercent: 5 },
  });
  useStore.getState().setJobPlacement({ startFrom: 'absolute', anchor: 'front-left' });
  const sim = createGrblSimulator({
    motionMs: 25,
    settings: [
      [22, '0'],
      [30, String(controllerS)],
      [32, '1'],
    ],
  });
  await useLaserStore
    .getState()
    .connect(sim.adapter, connectOptionsForDevice(useStore.getState().project.device));
  await vi.advanceTimersByTimeAsync(2_000);
  expect(useLaserStore.getState().controllerSettings?.maxPowerS).toBe(controllerS);
  return sim;
}

function addArtwork(id: string, x: number, y: number): string {
  useStore.getState().importSvgObject(rectangle(id, x, y));
  // Import intentionally centres artwork; the audit chooses its job location
  // using the same explicit placement action as the operator.
  useStore.getState().setObjectTransform(id, IDENTITY_TRANSFORM);
  const layer = useStore.getState().project.scene.layers.at(-1);
  if (layer === undefined) throw new Error('Imported artwork has no layer.');
  return layer.id;
}

function pulsePayload(sim: GrblSimulator): string {
  const pulses = sim.outbound().filter((payload) => payload.includes('\nG4 P1\nM5\n'));
  expect(pulses).toHaveLength(1);
  return pulses[0] ?? '';
}

describe('post-release interactions through actual Frame, mark and Start actions', () => {
  it.each([
    { profileS: 1000, controllerS: 255, markS: 2 },
    { profileS: 255, controllerS: 1000, markS: 2 },
  ])(
    'finishes an old run, clears its job, marks once and starts at current S$controllerS with profile S$profileS',
    async ({ profileS, controllerS, markS }) => {
      const sim = await connected(profileS, controllerS);
      const repository = frameOnceRepository();
      await repository.initialize();
      const oldLayer = addArtwork('old-canvas', 15, 25);
      useStore.getState().setLayerParam(oldLayer, { power: 71, speed: 987, passes: 3 });
      expect(await onClock(runFrameNow())).toBe(true);
      await onClock(runStartJobFlow(repository));
      const oldRun = repository.getSnapshot().activeRun;
      expect(oldRun).not.toBeNull();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(useLaserStore.getState().streamer).toBeNull();
      const display = useLaserStore.getState().liveCanvasRun;
      if (display === null || display === undefined || oldRun === null)
        throw new Error('Expected old run completion.');
      expect(display.lifecycle).toBe('finished');
      expect(dismissCompletedJobDisplay(display)).toBe(true);
      expect((await repository.completeRun(oldRun.runId)).ok).toBe(true);
      const machine = useStore.getState().project.device;
      useStore.getState().newProject();
      expect(useStore.getState().project.device).toEqual(machine);
      expect(useStore.getState().project.scene.objects).toEqual([]);
      expect(useLaserStore.getState().completedFrame).toBeNull();
      const layer = addArtwork('fresh-canvas', 80, 70);
      expect(useStore.getState().project.scene.layers.at(-1)).toMatchObject({
        power: LAYER_DEFAULTS.power,
        speed: LAYER_DEFAULTS.speed,
        passes: 1,
      });
      useStore.getState().setJobPlacement({ startFrom: 'absolute', anchor: 'front-left' });
      expect(await onClock(runFrameNow())).toBe(true);
      const spatialFrame = useLaserStore.getState().completedFrame;
      expect(spatialFrame).not.toBeNull();
      const frameLegs = sim.outbound().filter((line) => line.startsWith('$J=')).length;
      useStore.getState().setLayerParam(layer, { power: 100, speed: 678 });
      expect(useLaserStore.getState().completedFrame).toBe(spatialFrame);
      await useLaserStore.getState().sendRealtimeOverride('\x92');
      await useLaserStore.getState().sendRealtimeOverride('\x96');
      await useLaserStore.getState().sendRealtimeOverride('\x9a');
      expect(sim.state().overrides).toEqual({ feed: 90, rapid: 50, spindle: 110 });
      const before = { ...sim.state().mpos };
      const marked = await onClock(runJobStartMarkNow());
      expect(marked, JSON.stringify(useToastStore.getState().toasts)).toBe(true);
      expect(sim.state().mpos).toEqual(before);
      expect(sim.state().spindle).toBe(0);
      expect(sim.state().overrides).toEqual({ feed: 100, rapid: 100, spindle: 100 });
      expect(useLaserStore.getState().completedFrame).toBe(spatialFrame);
      expect(pulsePayload(sim)).toContain(`M3 S${markS}\nG4 P1\nM5\n`);
      const beam = powerUpGrbl(true);
      executeGrblLine(beam, pulsePayload(sim).trim().split('\n')[0] ?? '');
      expect(beam.errors).toEqual([]);
      expect(beam.beam).toBe(markS);
      executeGrblLine(beam, 'M5');
      expect(beam.beam).toBe(0);
      await onClock(runStartJobFlow(repository));
      const fresh = repository.getSnapshot().activeRun;
      expect(fresh?.runId).not.toBe(oldRun.runId);
      expect(fresh?.artifact.gcode).toMatch(new RegExp(`S${controllerS}(?:\\s|$)`));
      expect(fresh?.artifact.gcode).toContain('F678');
      expect(fresh?.artifact.gcode).not.toContain('F987');
      // Canvas Y points down, so a front-left machine emits bedHeight - Y.
      expect(fresh?.artifact.gcode).toMatch(/X80\.000 Y330\.000/);
      expect(fresh?.artifact.gcode).not.toMatch(/X15\.000 Y375\.000/);
      expect(useStore.getState().project.device.maxPowerS).toBe(profileS);
      expect(sim.outbound().filter((line) => line.startsWith('$J=')).length).toBe(frameLegs);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(useLaserStore.getState().streamer).toBeNull();
      expect(sim.state().machine).toBe('Idle');
      expect(sim.state().spindle).toBe(0);
      expect(useLaserStore.getState().lastWriteError).toBeNull();
    },
  );

  it('retains a completed mark/Frame while an actual $30 write changes the next reviewed output without changing the profile', async () => {
    const sim = await connected(1000, 1000);
    const repository = frameOnceRepository();
    await repository.initialize();
    const layer = addArtwork('range-change', 80, 70);
    useStore.getState().setLayerParam(layer, { power: 25, speed: 600 });
    expect(await onClock(runFrameNow())).toBe(true);
    const frame = useLaserStore.getState().completedFrame;
    expect(await onClock(runJobStartMarkNow())).toBe(true);
    expect(pulsePayload(sim)).toContain('M3 S10\n');
    await onClock(useLaserStore.getState().writeGrblSetting(30, '255'));
    expect(sim.state().settings.get(30)).toBe('255');
    expect(useLaserStore.getState().controllerSettings?.maxPowerS).toBe(255);
    expect(useLaserStore.getState().completedFrame).toBe(frame);
    const legCount = sim.outbound().filter((line) => line.startsWith('$J=')).length;
    await onClock(runStartJobFlow(repository));
    const artifact = repository.getSnapshot().activeRun?.artifact;
    expect(artifact?.gcode).toMatch(/S64(?:\s|$)/);
    expect(artifact?.gcode).not.toMatch(/S250(?:\s|$)/);
    expect(useStore.getState().project.device.maxPowerS).toBe(1000);
    expect(sim.outbound().filter((line) => line.startsWith('$J=')).length).toBe(legCount);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sim.state().machine).toBe('Idle');
    expect(sim.state().spindle).toBe(0);
  });

  it.each(['ordinary flow', 'keyboard shortcut', 'direct immutable flow'] as const)(
    'owns the real simulator dwell for exactly one second and rejects a concurrent $0 without spoiling the returned Frame',
    async (entry) => {
      const sim = await connected(1000, 1000);
      const repository = frameOnceRepository();
      await repository.initialize();
      const layer = addArtwork('one-second-dot', 80, 70);
      useStore.getState().setLayerParam(layer, { power: 85, speed: 600 });
      expect(await onClock(runFrameNow())).toBe(true);
      const frame = useLaserStore.getState().completedFrame;
      const marking = runJobStartMarkNow();
      const atPulse = () => {
        const line = sim.state().pendingLine;
        return line?.kind === 'dwell' && line.seconds === 1 && line.phase === 'delay';
      };
      for (let tick = 0; tick < 3_000 && !atPulse(); tick += 1)
        await vi.advanceTimersByTimeAsync(1);
      expect(atPulse()).toBe(true);
      expect(sim.state().mpos).toEqual({ x: 80, y: 330, z: 0 });
      expect(sim.state().spindle).toBe(10);
      expect(useLaserStore.getState().fireActive).toBe(true);
      const position = { ...sim.state().mpos };
      const pulseOwner = useLaserStore.getState().controllerOperation;
      const pulseWrites = [...sim.outbound()];
      if (entry === 'keyboard shortcut') {
        const uninstall = installJobShortcuts(window);
        try {
          const event = new KeyboardEvent('keydown', {
            key: 'Enter',
            ctrlKey: true,
            cancelable: true,
          });
          window.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(true);
          await Promise.resolve();
        } finally {
          uninstall();
        }
      } else if (entry === 'direct immutable flow') {
        if (frame === null || frame === undefined) throw new Error('Expected completed Frame.');
        const immutable = Object.freeze({
          ...frame,
          candidate: Object.freeze({
            ...frame.candidate,
            authorizationContext: 'laser-second-pass' as const,
          }),
        });
        expect(await runFramedPermitStart(immutable, repository)).toBe(false);
      } else await runStartJobFlow(repository);
      expect(repository.getSnapshot().activeRun).toBeNull();
      expect(useLaserStore.getState().streamer).toBeNull();
      expect(useToastStore.getState().toasts.at(-1)?.message).toContain('timed start mark');
      expect(useLaserStore.getState().completedFrame).toBe(frame);
      expect(useLaserStore.getState().controllerOperation).toBe(pulseOwner);
      expect(sim.outbound()).toEqual(pulseWrites);
      await vi.advanceTimersByTimeAsync(999);
      expect(sim.state().mpos).toEqual(position);
      expect(sim.state().spindle).toBe(10);
      await vi.advanceTimersByTimeAsync(1);
      expect(sim.state().spindle).toBe(0);
      expect(await onClock(marking)).toBe(true);
      expect(useLaserStore.getState().completedFrame).toBe(frame);
      expect(sim.state().mpos).toEqual({ x: 0, y: 0, z: 0 });
      await onClock(runStartJobFlow(repository));
      expect(repository.getSnapshot().activeRun?.artifact.gcode).toMatch(/S850(?:\s|$)/);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(useLaserStore.getState().streamer).toBeNull();
    },
  );

  it.each(['reset', 'WCO change and reversal'] as const)(
    'requires a new Frame after %s, then marks and starts successfully without inheriting the lost permit',
    async (change) => {
      const sim = await connected(1000, 1000);
      const repository = frameOnceRepository();
      await repository.initialize();
      const layer = addArtwork('coordinate-retry', 80, 70);
      useStore.getState().setLayerParam(layer, { power: 30, speed: 600 });
      expect(await onClock(runFrameNow())).toBe(true);
      const oldFrame = useLaserStore.getState().completedFrame;
      expect(await onClock(runJobStartMarkNow())).toBe(true);
      if (change === 'reset') {
        expect(await onClock(useLaserStore.getState().wakeController())).toBe('idle');
        await vi.advanceTimersByTimeAsync(1_200);
        expect(useLaserStore.getState().controllerSessionEpoch).not.toBe(
          oldFrame?.controller.controllerSessionEpoch,
        );
      } else {
        await onClock(
          useLaserStore.getState().sendConsoleCommand('G10 L2 P1 X5 Y7 Z0', { confirmed: true }),
        );
        await vi.advanceTimersByTimeAsync(500);
        expect(sim.state().g54).toEqual({ x: 5, y: 7, z: 0 });
        await onClock(
          useLaserStore.getState().sendConsoleCommand('G10 L2 P1 X0 Y0 Z0', { confirmed: true }),
        );
        await vi.advanceTimersByTimeAsync(500);
        expect(sim.state().g54).toEqual({ x: 0, y: 0, z: 0 });
      }
      expect(useLaserStore.getState().completedFrame).toBeNull();
      await onClock(runStartJobFlow(repository));
      expect(repository.getSnapshot().activeRun).toBeNull();
      expect(useLaserStore.getState().streamer).toBeNull();
      expect(await onClock(runFrameNow())).toBe(true);
      expect(useLaserStore.getState().completedFrame).not.toBe(oldFrame);
      expect(await onClock(runJobStartMarkNow())).toBe(true);
      expect(sim.outbound().filter((payload) => payload.includes('\nG4 P1\nM5\n'))).toHaveLength(2);
      await onClock(runStartJobFlow(repository));
      expect(repository.getSnapshot().activeRun?.artifact.gcode).toMatch(/S300(?:\s|$)/);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(sim.state().spindle).toBe(0);
      expect(useLaserStore.getState().streamer).toBeNull();
    },
  );
});
