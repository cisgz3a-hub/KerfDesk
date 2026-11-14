// Watches every job with the camera (ADR-490). When a job starts streaming
// and the operator asked for it, a timelapse starts recording and the burn
// check takes its first picture; when the job ends (finished, stopped, lost
// or failed), the recording ends with a frame of the result and a finished
// job is checked against its path. Nothing here moves the machine: the
// pictures are taken wherever the head happens to be.

import { useEffect } from 'react';
import type { Vec2 } from '../../../core/scene';
import type {
  CanvasMotionPlan,
  LiveCanvasLifecycle,
  LiveCanvasRun,
} from '../../state/canvas-motion-plan';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { nativeBedUnknownReason, nativeBedUnknownWhy } from '../../state/native-bed-unknown-reason';
import { headPositionNow } from '../head/head-position';
import {
  burnCheckBlocker,
  compareAfterPicture,
  takeBeforePicture,
  type BeforePicture,
  type BurnWatch,
} from './burn-check-run';
import { burnRegion, planPlacesOnBed } from './job-burn-route';
import {
  defaultWatchIo,
  watchCameraNow,
  watchCameraStillRunning,
  type WatchCamera,
  type WatchIo,
} from './job-watch-camera';
import { useToastStore } from '../../state/toast-store';
import {
  KEPT_TIMELAPSE_NOTE,
  unsavedTimelapse,
  useJobWatchStore,
  type BurnCheckView,
  type TimelapseView,
} from './job-watch-store';
import { startTimelapse, type TimelapseRecorder } from './timelapse-recorder';

// The after picture waits for the smoke to clear and the head to settle.
export const AFTER_SETTLE_MS = 3000;

const ENDED: ReadonlySet<LiveCanvasLifecycle> = new Set([
  'stopped',
  'disconnected',
  'errored',
  'finished',
]);

type WatchedJob = {
  readonly generation: number;
  readonly plan: CanvasMotionPlan;
  readonly camera: WatchCamera | null;
  readonly recorder: TimelapseRecorder | null;
  readonly before: Promise<BeforePicture> | null;
};

let generation = 0;
let lastBurnWatch: BurnWatch | null = null;

export function installJobWatch(io: WatchIo = defaultWatchIo): () => void {
  let seen: { readonly plan: CanvasMotionPlan; readonly startedAtMs: number } | null = null;
  let job: WatchedJob | null = null;
  const observe = (run: LiveCanvasRun | null): void => {
    if (run !== null && (seen?.plan !== run.plan || seen.startedAtMs !== run.startedAtMs)) {
      seen = { plan: run.plan, startedAtMs: run.startedAtMs };
      if (job !== null) void endJob(job, 'stopped', io);
      job = ENDED.has(run.lifecycle) ? null : beginJob(run.plan, io);
      return;
    }
    if (job !== null && (run === null || ENDED.has(run.lifecycle))) {
      const ended = job;
      job = null;
      void endJob(ended, run?.lifecycle ?? 'stopped', io);
    }
  };
  observe(useLaserStore.getState().liveCanvasRun ?? null);
  return useLaserStore.subscribe((state) => observe(state.liveCanvasRun ?? null));
}

export function useJobWatch(): void {
  useEffect(() => installJobWatch(), []);
}

function beginJob(plan: CanvasMotionPlan, io: WatchIo): WatchedJob | null {
  const { settings } = useJobWatchStore.getState();
  // Every new run changes the work under the camera, even when watching was
  // switched off. An older after-picture wait or capture must not compare the
  // new work against the previous job's route.
  generation += 1;
  // A completed verdict may remain visible, but another run also means a
  // fresh picture can no longer isolate the work in that verdict.
  lastBurnWatch = null;
  if (!settings.timelapse && !settings.burnCheck) {
    retirePendingWatch();
    return null;
  }
  const current = generation;
  const isCurrent = (): boolean => generation === current;
  clearBurnCheckResult();
  const kept = keepUnsavedTimelapse(settings.timelapse);
  const camera = watchCameraNow();
  const region = planPlacesOnBed(plan) ? burnRegion(plan) : null;
  let recorder: TimelapseRecorder | null = null;
  if (settings.timelapse && !kept && camera === null) {
    useJobWatchStore.setState({ timelapse: notRecorded() });
  } else if (settings.timelapse && !kept && camera !== null) {
    recorder = startTimelapse({
      camera,
      region,
      intervalMs: settings.intervalSeconds * 1000,
      io,
      jobRunning: () => runOf(plan)?.lifecycle === 'running',
      isCurrent,
    });
  }
  const before = settings.burnCheck ? startBurnCheck(plan, region, camera, io, isCurrent) : null;
  return { generation: current, plan, camera, recorder, before };
}

// ADR-490 Amendment 4: a new run (Continue, Second pass, the next job) never
// empties a recording that was not saved or cleared. It is kept, finished,
// and this run is not recorded; the note and a toast say so, and Job Review
// said so before Start. True when one was kept.
function keepUnsavedTimelapse(recordingWanted: boolean): boolean {
  const timelapse = useJobWatchStore.getState().timelapse;
  if (!unsavedTimelapse(timelapse)) {
    useJobWatchStore.setState({ timelapse: null });
    return false;
  }
  const note = recordingWanted ? KEPT_TIMELAPSE_NOTE : timelapse.note;
  useJobWatchStore.setState({ timelapse: { ...timelapse, recording: false, note } });
  if (recordingWanted) {
    useToastStore
      .getState()
      .pushToast(`Timelapse: ${KEPT_TIMELAPSE_NOTE}`, 'warning', { key: 'timelapse-kept' });
  }
  return true;
}

function retirePendingWatch(): void {
  const { burnCheck, timelapse } = useJobWatchStore.getState();
  if (burnCheck.kind === 'watching' || burnCheck.kind === 'checking') {
    lastBurnWatch = null;
    useJobWatchStore.setState({
      burnCheck: {
        kind: 'unavailable',
        reason: 'Another job started before the after picture was ready.',
      },
    });
  }
  if (timelapse?.recording === true) {
    useJobWatchStore.setState({
      timelapse: {
        ...timelapse,
        recording: false,
        note: 'Another job started before the final picture was ready.',
      },
    });
  }
}

// Why this firmware and session have no bed mapping, for the burn check's
// "unavailable" line (annoyance audit A2 B3-P2-2).
function bedUnknownWhy(plan: CanvasMotionPlan): string | null {
  const reason = nativeBedUnknownReason(plan.device, useLaserStore.getState());
  return reason === null ? null : nativeBedUnknownWhy(reason, plan.device);
}

function startBurnCheck(
  plan: CanvasMotionPlan,
  region: ReturnType<typeof burnRegion>,
  camera: WatchCamera | null,
  io: WatchIo,
  isCurrent: () => boolean,
): Promise<BeforePicture> | null {
  const blocker = burnCheckBlocker(plan, camera, bedUnknownWhy(plan));
  if (blocker !== null || camera === null) {
    setBurnCheck({ kind: 'unavailable', reason: blocker ?? '' }, isCurrent);
    return null;
  }
  setBurnCheck({ kind: 'watching' }, isCurrent);
  const before = takeBeforePicture({
    plan,
    region,
    camera,
    io,
    headNow: headPositionNow,
    confirmedRouteMm: () => runOf(plan)?.route.confirmedRouteMm ?? 0,
  });
  void before.then((result) => {
    if (result.kind === 'unavailable') {
      setBurnCheck({ kind: 'unavailable', reason: result.reason }, isCurrent);
    }
  });
  return before;
}

async function endJob(job: WatchedJob, lifecycle: LiveCanvasLifecycle, io: WatchIo): Promise<void> {
  const isCurrent = (): boolean => generation === job.generation;
  job.recorder?.stop();
  const watch = await burnWatchToCheck(job, lifecycle, isCurrent);
  if (job.recorder === null && watch === null) return;
  if (watch !== null) setBurnCheck({ kind: 'checking' }, isCurrent);
  await io.wait(AFTER_SETTLE_MS);
  const camera = job.camera;
  const frame =
    camera !== null && watchCameraStillRunning(camera) && isCurrent()
      ? await io.captureFrame(camera.source)
      : null;
  if (!isCurrent()) return;
  await job.recorder?.finish(frame);
  if (watch === null) return;
  lastBurnWatch = watch;
  finishBurnCheck(watch, frame, headPositionNow(), isCurrent);
}

// Only a finished job is checked; one that ended any other way says so.
async function burnWatchToCheck(
  job: WatchedJob,
  lifecycle: LiveCanvasLifecycle,
  isCurrent: () => boolean,
): Promise<BurnWatch | null> {
  const before = job.before === null ? null : await job.before;
  if (before?.kind !== 'ok') return null;
  if (lifecycle === 'finished') return before.watch;
  setBurnCheck(
    { kind: 'unavailable', reason: 'The job did not finish, so there is nothing to check.' },
    isCurrent,
  );
  return null;
}

function finishBurnCheck(
  watch: BurnWatch,
  frame: Parameters<typeof compareAfterPicture>[1] | null,
  head: Vec2 | null,
  isCurrent: () => boolean,
): void {
  const view: BurnCheckView =
    frame === null
      ? { kind: 'unavailable', reason: 'The camera did not send a picture after the job.' }
      : compareAfterPicture(watch, frame, head);
  setBurnCheck(view, isCurrent);
  if (view.kind === 'done' && isCurrent()) showBurnCheckOnCanvas();
}

/** Check the last job again from a fresh after picture (the head was in the way). */
export async function retakeAfterPicture(io: WatchIo = defaultWatchIo): Promise<void> {
  const watch = lastBurnWatch;
  if (watch === null) return;
  const current = generation;
  const isCurrent = (): boolean => generation === current;
  if (!watchCameraStillRunning(watch.camera)) {
    setBurnCheck(
      {
        kind: 'unavailable',
        reason: 'Start the camera that watched the job to take the picture again.',
      },
      isCurrent,
    );
    return;
  }
  setBurnCheck({ kind: 'checking' }, isCurrent);
  const frame = await io.captureFrame(watch.camera.source);
  finishBurnCheck(watch, frame, headPositionNow(), isCurrent);
}

/** Whether the last job's check can take its after picture again. */
export function canRetakeAfterPicture(): boolean {
  return lastBurnWatch !== null;
}

/** Forget the last check, taking its picture off the canvas if it is there. */
export function clearBurnCheckResult(): void {
  const view = useJobWatchStore.getState().burnCheck;
  const camera = useCameraStore.getState();
  if (view.kind === 'done' && camera.bedPicture === view.picture) camera.setBedPicture(null);
  lastBurnWatch = null;
  useJobWatchStore.setState({ burnCheck: { kind: 'idle' } });
}

export function showBurnCheckOnCanvas(): void {
  const view = useJobWatchStore.getState().burnCheck;
  if (view.kind !== 'done') return;
  const camera = useCameraStore.getState();
  camera.setOverlayVisible(true);
  camera.setBedPicture(view.picture);
}

function setBurnCheck(view: BurnCheckView, isCurrent: () => boolean): void {
  if (isCurrent()) useJobWatchStore.setState({ burnCheck: view });
}

function runOf(plan: CanvasMotionPlan): LiveCanvasRun | null {
  const run = useLaserStore.getState().liveCanvasRun ?? null;
  return run?.plan === plan ? run : null;
}

function notRecorded(): TimelapseView {
  return {
    frames: [],
    intervalMs: 0,
    flat: false,
    recording: false,
    note: 'The camera was not running when the job started, so there is no timelapse.',
  };
}
