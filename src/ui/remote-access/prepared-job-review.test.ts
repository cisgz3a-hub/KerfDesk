import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { useCameraStore } from '../state/camera-store';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { currentOutputScope } from '../state/output-scope-state';
import { installFrameOnceProject } from '../laser/frame-once.test-support';
import { installReviewPendingFramedRunPermitForCurrentState } from '../laser/framed-run-testing';
import { ensureFramedRunInvalidationSubscriptions } from '../laser/framed-run-invalidation';
import { prepareCurrentStartJob } from '../laser/start-job-source';
import * as source from '../laser/start-job-source';
import { useJobReviewStore } from '../laser/job-review/job-review-store';
import {
  modelFor,
  runJobReviewGate,
  type ReviewedStartBundle,
} from '../laser/job-review/job-review-gate';
import {
  currentReviewedJobSnapshot,
  publishReviewedJobSnapshot,
} from '../laser/job-review/reviewed-job-snapshot';
import { preparedJobReview } from './prepared-job-review';
import { prepareRemoteJobReview } from './job-review-preparation';

beforeEach(() => {
  installFrameOnceProject();
  ensureFramedRunInvalidationSubscriptions();
  useCameraStore.setState({ placementActive: false, confirmedPositionEpoch: null });
  useJobReviewStore.getState().close();
  useFramePreparationStore.setState({ pending: false });
});
afterEach(() => {
  useJobReviewStore.getState().close();
  useFramePreparationStore.setState({ pending: false });
  vi.restoreAllMocks();
});
async function bundle(): Promise<ReviewedStartBundle> {
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  const camera = useCameraStore.getState();
  const prepared = await prepareCurrentStartJob(app, laser, camera, undefined, false);
  if (!prepared.ok) throw Error(prepared.messages.join('; '));
  return {
    app,
    laser,
    project: app.project,
    prepared,
    laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
    outputScope: currentOutputScope(app),
    preparedMachineInputsKey: source.startMachineInputsKey(app.project, laser, camera),
  };
}
function delayed<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('current remote job review uses real preparation without execution', () => {
  it('prepares warnings, duration and bounds without opening a desktop dialog or machine actions', async () => {
    const laser = useLaserStore.getState();
    const actions = [vi.spyOn(laser, 'startJob'), vi.spyOn(laser, 'frame'), vi.spyOn(laser, 'jog')];
    const real = await bundle();
    const review = await preparedJobReview('revision-current');
    expect(review).toMatchObject({
      revision: 'revision-current',
      status: 'ready',
      mode: 'laser',
      frame: { required: true, complete: false },
      summary: {
        artworkCount: 1,
        operationCount: 1,
        estimatedSeconds: real.prepared.metrics.duration.totalSeconds,
        bounds: { xMm: 1, yMm: 391, widthMm: 8, heightMm: 8 },
      },
    });
    expect(review.warnings.map((warning) => warning.message)).toEqual(modelFor(real).warnings);
    expect(useJobReviewStore.getState().state.kind).toBe('idle');
    expect(useLaserStore.getState().framedRun).toBeNull();
    actions.forEach((action) => expect(action).not.toHaveBeenCalled());
    expect(JSON.stringify(review)).not.toMatch(/gcode|frame-once\.svg|serialPort|licenseKey/);
  });
  it('returns actual unknown-status refusal instead of invented readiness', async () => {
    useLaserStore.setState({ statusReport: null });
    const review = await preparedJobReview('unknown');
    expect(review.status).toBe('unavailable');
    expect(review.summary).toBeUndefined();
    expect(review.warnings.map((warning) => warning.message).join(' ')).toContain(
      'has not reported its status',
    );
    expect(review.frame.complete).toBe(false);
  });
  it('uses only completed spatial evidence and validates the freshly compiled envelope', async () => {
    const permit = await installReviewPendingFramedRunPermitForCurrentState();
    const review = await preparedJobReview('framed');
    expect(review.status).toBe('ready');
    expect(review.frame.complete).toBe(true);
    expect(useLaserStore.getState().completedFrame).toBe(permit);
  });
  it('changes timing for current power/speed while retaining the unchanged Frame', async () => {
    const permit = await installReviewPendingFramedRunPermitForCurrentState();
    const before = await preparedJobReview('before');
    useStore.getState().setLayerParam('red', { speed: 600, power: 19 });
    const after = await preparedJobReview('after');
    expect(after.status).toBe('ready');
    expect(after.frame.complete).toBe(true);
    expect(after.summary?.estimatedSeconds).not.toBe(before.summary?.estimatedSeconds);
    expect(useLaserStore.getState().completedFrame).toBe(permit);
    const compiled = await bundle();
    expect(compiled.prepared.gcode).toMatch(/S190(?:\s|$)/);
    expect(compiled.prepared.gcode).toMatch(/F600/);
  });
  it('does not retain Frame after geometry or controller-session changes', async () => {
    await installReviewPendingFramedRunPermitForCurrentState();
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: state.project.scene.objects.map((object) => ({
            ...object,
            transform: { ...object.transform, x: 4 },
          })),
        },
      },
    }));
    expect((await preparedJobReview('moved')).frame.complete).toBe(false);
    await installReviewPendingFramedRunPermitForCurrentState();
    useLaserStore.setState({ controllerSessionEpoch: 8 });
    expect((await preparedJobReview('reconnected')).frame.complete).toBe(false);
  });
  it('selection alone retains Frame when output scope remains all artwork', async () => {
    await installReviewPendingFramedRunPermitForCurrentState();
    useStore.setState({ selectedObjectId: 'line-object' });
    expect((await preparedJobReview('selected')).frame.complete).toBe(true);
  });
  it('never reuses the prior canvas review after New', async () => {
    await installReviewPendingFramedRunPermitForCurrentState();
    const old = await bundle();
    const model = modelFor(old);
    useJobReviewStore.getState().open(model);
    publishReviewedJobSnapshot(old, model);
    useStore.getState().newProject();
    const review = await preparedJobReview('new');
    expect(review.frame.complete).toBe(false);
    expect(review.status).toBe('unavailable');
    expect(review.summary).toBeUndefined();
  });
  it('reports preparation without claiming the pending Frame completed', async () => {
    useFramePreparationStore.setState({ pending: true });
    expect(await preparedJobReview('pending')).toMatchObject({
      status: 'preparing',
      frame: { complete: false },
    });
  });
  it('preserves genuine existing Frame evidence while current compilation is unavailable', async () => {
    await installReviewPendingFramedRunPermitForCurrentState();
    vi.spyOn(source, 'prepareCurrentStartJob').mockResolvedValue({
      ok: false,
      messages: ['Current preparation unavailable.'],
    });
    expect(await preparedJobReview('missing-program')).toMatchObject({
      status: 'unavailable',
      frame: { complete: true },
    });
  });
  it('reuses only the exact currently displayed owner, then retires its snapshot on cancel', async () => {
    const initial = await bundle();
    const gate = runJobReviewGate({ initial, completedReceipt: null });
    const published = currentReviewedJobSnapshot();
    expect(published?.bundle).toBe(initial);
    const prepare = vi.spyOn(source, 'prepareCurrentStartJob');
    const review = await preparedJobReview('displayed');
    expect(review.status).toBe('ready');
    expect(review.message).toContain('displayed');
    expect(prepare).not.toHaveBeenCalled();
    useJobReviewStore.getState().cancel();
    await gate;
    expect(currentReviewedJobSnapshot()).toBeNull();
  });
  it('cannot expose the previous owner while its review is rebuilding', async () => {
    const initial = await bundle();
    const model = modelFor(initial);
    useJobReviewStore.getState().open(model);
    publishReviewedJobSnapshot(initial, model);
    useJobReviewStore.getState().beginPrepare();
    expect(currentReviewedJobSnapshot()).toBeNull();
    expect(await preparedJobReview('rebuild')).toMatchObject({ status: 'preparing' });
  });
  it('recompiles a changed process instead of reusing an old displayed model', async () => {
    const initial = await bundle();
    const model = modelFor(initial);
    useJobReviewStore.getState().open(model);
    publishReviewedJobSnapshot(initial, model);
    useStore.getState().setLayerParam('red', { speed: 500 });
    const prepare = vi.spyOn(source, 'prepareCurrentStartJob');
    const review = await preparedJobReview('new-process');
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(review.status).toBe('ready');
    expect(review.message).not.toContain('displayed');
    expect(review.summary?.estimatedSeconds).not.toBe(
      initial.prepared.metrics.duration.totalSeconds,
    );
  });
  it('rejects stale async geometry before publishing its results', async () => {
    const initial = await bundle();
    const held = delayed<typeof initial.prepared>();
    vi.spyOn(source, 'prepareCurrentStartJob').mockImplementation(async () => held.promise);
    const pending = preparedJobReview('old');
    useStore.getState().setLayerParam('red', { speed: 800 });
    held.resolve(initial.prepared);
    const result = await pending;
    expect(result.status).toBe('unavailable');
    expect(result.summary).toBeUndefined();
  });
  it('rejects camera observation changes during async preparation', async () => {
    const initial = await bundle();
    const held = delayed<typeof initial.prepared>();
    vi.spyOn(source, 'prepareCurrentStartJob').mockImplementation(async () => held.promise);
    const pending = preparedJobReview('camera');
    useCameraStore.setState({ placementActive: true });
    held.resolve(initial.prepared);
    expect((await pending).status).toBe('unavailable');
  });
  it('updates Frame status if coordinates drift during failed preparation', async () => {
    await installReviewPendingFramedRunPermitForCurrentState();
    const initial = await bundle();
    const held = delayed<typeof initial.prepared>();
    vi.spyOn(source, 'prepareCurrentStartJob').mockImplementation(async () => held.promise);
    const pending = preparedJobReview('drift');
    useLaserStore.setState({ wcoCache: { x: 2, y: 0, z: 0 } });
    held.resolve(initial.prepared);
    expect(await pending).toMatchObject({ status: 'unavailable', frame: { complete: false } });
  });
  it('caller cancellation aborts its preparation and exposes no result', async () => {
    const initial = await bundle();
    const held = delayed<typeof initial.prepared>();
    const prepare = vi
      .spyOn(source, 'prepareCurrentStartJob')
      .mockImplementation(async () => held.promise);
    const controller = new AbortController();
    const pending = preparedJobReview('cancel', controller.signal);
    controller.abort();
    expect(prepare.mock.calls[0]?.[5]?.aborted).toBe(true);
    held.resolve(initial.prepared);
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('pre-cancelled calls do not begin compilation', async () => {
    const controller = new AbortController();
    controller.abort();
    const prepare = vi.spyOn(source, 'prepareCurrentStartJob');
    await expect(preparedJobReview('cancel', controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(prepare).not.toHaveBeenCalled();
  });
  it('coalesces capacity by reporting concurrent preparations instead of duplicating work', async () => {
    const initial = await bundle();
    const held = delayed<typeof initial.prepared>();
    const prepare = vi
      .spyOn(source, 'prepareCurrentStartJob')
      .mockImplementation(async () => held.promise);
    const first = prepareRemoteJobReview(useStore.getState(), useLaserStore.getState());
    expect(
      await prepareRemoteJobReview(useStore.getState(), useLaserStore.getState()),
    ).toMatchObject({ ok: false, status: 'preparing' });
    expect(prepare).toHaveBeenCalledTimes(1);
    held.resolve(initial.prepared);
    expect((await first).ok).toBe(true);
  });
});
