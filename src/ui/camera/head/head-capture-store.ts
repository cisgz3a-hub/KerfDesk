// The head camera's capture (ADR-449): Capture here takes one picture where
// the head is; Capture selection / Capture bed jogs the head over that area,
// taking a picture at each stop, and stitches them into one top-down picture
// shown on the canvas. Moves use the same beam-off jog as Move laser here,
// under the same readiness rules; Stop cancels the jog in progress and keeps
// the pictures already taken.

import { create } from 'zustand';
import type { BedArea } from '../../../core/camera/model/camera-model-accuracy';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import {
  headCameraView,
  isHeadCameraModel,
  planHeadCaptures,
} from '../../../core/camera/model/head-camera';
import {
  stitchHeadCameraPictures,
  type HeadCameraPicture,
} from '../../../core/camera/model/head-camera-stitch';
import { ownModelFor } from '../../../core/camera/model/saved-cameras';
import { bedPointToNative } from '../../../core/devices/native-bed-frame';
import type { Vec2 } from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { jogFrameCommandBlockMessage } from '../../state/laser-store-helpers';
import { resolveNativeBedFrame } from '../../state/native-bed-frame';
import {
  clampToBed,
  positionLaserFeed,
  positionLaserTarget,
} from '../../workspace/position-laser-click';
import { cameraSourceIdentity, captureSourceFrame, type ActiveCameraSource } from '../frame-source';
import { runHeadCapture, type HeadCaptureIo, type HeadSettle } from './head-capture-run';
import { headPositionNow } from './head-position';

export type HeadCaptureState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'running';
      readonly taken: number;
      readonly total: number;
      readonly stopping: boolean;
    }
  | { readonly kind: 'finished'; readonly note: string | null }
  | { readonly kind: 'failed'; readonly message: string };

type HeadCaptureStore = {
  readonly state: HeadCaptureState;
  readonly stop: () => void;
};

export const useHeadCaptureStore = create<HeadCaptureStore>((set, get) => ({
  state: { kind: 'idle' },
  stop: () => {
    const { state } = get();
    if (state.kind !== 'running' || state.stopping) return;
    set({ state: { ...state, stopping: true } });
    void useLaserStore
      .getState()
      .cancelJog()
      .catch(() => undefined);
  },
}));

export type HeadCaptureTarget =
  | { readonly kind: 'here' }
  | { readonly kind: 'area'; readonly area: BedArea };

export const HEAD_POSITION_UNKNOWN =
  'KerfDesk needs to know where the head is: connect the machine and home it.';
const NOT_HEAD_CAMERA = 'The running camera is not calibrated as a camera on the laser head.';
const NO_VIEW =
  'The head camera does not see the bed at this material height. Check the material height, or calibrate the camera again.';

// Stitched pictures are drawn at up to this detail, and no larger than this.
const MAX_PIXELS_PER_MM = 4;
const MAX_PICTURE_SIDE_PX = 3000;
// A picture is taken this long after the head stops, so it is not blurred.
const PICTURE_SETTLE_MS = 300;
const POLL_MS = 100;
const ARRIVAL_TOLERANCE_MM = 0.1;
const MIN_MOVE_WAIT_MS = 15_000;
const MOVING_STATES = new Set(['Idle', 'Jog', 'Run']);

/** Capture with the running head camera; the outcome lands in the store. */
export async function captureWithHeadCamera(target: HeadCaptureTarget): Promise<void> {
  const store = useHeadCaptureStore;
  if (store.getState().state.kind === 'running') return;
  const setup = captureSetup(target);
  if (setup.kind === 'failed') {
    store.setState({ state: { kind: 'failed', message: setup.message } });
    return;
  }
  const { record, source, stops, region, coversArea } = setup;
  store.setState({ state: { kind: 'running', taken: 0, total: stops.length, stopping: false } });
  const outcome = await runHeadCapture(stops, machineIo(target, source, stops.length));
  const shown = showPictures(record, outcome.pictures, region);
  store.setState({ state: finalState(outcome, stops.length, shown, coversArea) });
}

type Setup =
  | {
      readonly kind: 'ready';
      readonly record: CameraModelRecord;
      readonly source: ActiveCameraSource;
      readonly stops: ReadonlyArray<Vec2>;
      readonly region: BedArea;
      readonly coversArea: boolean;
    }
  | { readonly kind: 'failed'; readonly message: string };

function captureSetup(target: HeadCaptureTarget): Setup {
  const camera = useCameraStore.getState();
  const { device } = useStore.getState().project;
  if (camera.sourceState.kind !== 'live') {
    return { kind: 'failed', message: 'Start the head camera first.' };
  }
  const source = camera.sourceState.source;
  const record = ownModelFor(device, cameraSourceIdentity(source));
  if (record === undefined || !isHeadCameraModel(record)) {
    return { kind: 'failed', message: NOT_HEAD_CAMERA };
  }
  const head = headPositionNow();
  if (head === null) return { kind: 'failed', message: HEAD_POSITION_UNKNOWN };
  const view = headCameraView(record, camera.surfaceHeightMm);
  if (view === null) return { kind: 'failed', message: NO_VIEW };
  const bed = { width: device.bedWidth, height: device.bedHeight };
  if (target.kind === 'here') {
    const seen = clipToBed({ ...view, x: head.x + view.x, y: head.y + view.y }, bed);
    if (seen === null) return { kind: 'failed', message: NO_VIEW };
    return { kind: 'ready', record, source, stops: [head], region: seen, coversArea: true };
  }
  const blocked = machineBlockedMessage();
  if (blocked !== null) return { kind: 'failed', message: blocked };
  const plan = planHeadCaptures(view, target.area, bed);
  return {
    kind: 'ready',
    record,
    source,
    stops: plan.heads,
    region: target.area,
    coversArea: plan.coversArea,
  };
}

function machineBlockedMessage(): string | null {
  const laser = useLaserStore.getState();
  if (laser.connection.kind !== 'connected') return 'Connect the machine to move the head.';
  return jogFrameCommandBlockMessage(laser);
}

function machineIo(
  target: HeadCaptureTarget,
  source: ActiveCameraSource,
  total: number,
): HeadCaptureIo {
  const epoch = useCameraStore.getState().sourceEpoch;
  const stopRequested = (): boolean => {
    const { state } = useHeadCaptureStore.getState();
    return state.kind === 'running' && state.stopping;
  };
  return {
    moveTo: target.kind === 'here' ? async () => undefined : jogHeadTo,
    settleAt: (stop) => settleAt(stop, stopRequested),
    takePicture: async () => {
      await sleep(PICTURE_SETTLE_MS);
      if (useCameraStore.getState().sourceEpoch !== epoch) return null;
      // A network camera may hand back a picture it started before the head
      // stopped; the second one began after it.
      const first = await captureSourceFrame(source);
      return first === null ? null : captureSourceFrame(source);
    },
    stopRequested,
    onProgress: (taken) =>
      useHeadCaptureStore.setState((s) =>
        s.state.kind === 'running' ? { state: { ...s.state, taken, total } } : s,
      ),
  };
}

async function jogHeadTo(head: Vec2): Promise<void> {
  const { device } = useStore.getState().project;
  const laser = useLaserStore.getState();
  const frame = resolveNativeBedFrame(device, laser);
  if (frame === null) throw new Error(HEAD_POSITION_UNKNOWN);
  const target = bedPointToNative(positionLaserTarget(head, device), frame);
  await laser.jogToMachinePosition(target.x, target.y, positionLaserFeed(device.maxFeed));
}

async function settleAt(stop: Vec2, stopRequested: () => boolean): Promise<HeadSettle> {
  const { device } = useStore.getState().project;
  const target = clampToBed(stop, device.bedWidth, device.bedHeight);
  const start = headPositionNow();
  const travel = start === null ? 0 : Math.hypot(target.x - start.x, target.y - start.y);
  const deadline =
    Date.now() + MIN_MOVE_WAIT_MS + (travel / positionLaserFeed(device.maxFeed)) * 60_000 * 2;
  for (;;) {
    const reading = settleReading(target, stopRequested);
    if (reading !== null) return reading;
    if (Date.now() > deadline) {
      return { kind: 'failed', message: 'The head did not come to rest in time.' };
    }
    await sleep(POLL_MS);
  }
}

// Settled, failed, or null while the head is still on its way.
function settleReading(target: Vec2, stopRequested: () => boolean): HeadSettle | null {
  const laser = useLaserStore.getState();
  if (laser.connection.kind !== 'connected') {
    return { kind: 'failed', message: 'The machine disconnected.' };
  }
  const state = laser.statusReport?.state;
  if (state !== undefined && !MOVING_STATES.has(state)) {
    return { kind: 'failed', message: `The machine stopped moving the head (${state}).` };
  }
  const head = headPositionNow();
  if (laser.motionOperation !== null || state !== 'Idle' || head === null) return null;
  return stopRequested() || near(head, target) ? { kind: 'settled', headMm: head } : null;
}

function showPictures(
  record: CameraModelRecord,
  pictures: ReadonlyArray<HeadCameraPicture>,
  region: BedArea,
): boolean {
  if (pictures.length === 0) return false;
  const camera = useCameraStore.getState();
  const pixelsPerMm = Math.min(
    MAX_PIXELS_PER_MM,
    MAX_PICTURE_SIDE_PX / Math.max(region.width, region.height),
  );
  const image = stitchHeadCameraPictures(record, pictures, {
    region,
    pixelsPerMm,
    surfaceHeightMm: camera.surfaceHeightMm,
  });
  if (image === null) return false;
  camera.setBedPicture({ image, region, surfaceHeightMm: camera.surfaceHeightMm });
  camera.setOverlayVisible(true);
  return true;
}

function finalState(
  outcome: Awaited<ReturnType<typeof runHeadCapture>>,
  total: number,
  shown: boolean,
  coversArea: boolean,
): HeadCaptureState {
  const taken = outcome.pictures.length;
  const kept = shown && taken < total ? ` The ${taken} pictures taken are shown.` : '';
  switch (outcome.kind) {
    case 'done':
      return {
        kind: 'finished',
        note: coversArea
          ? null
          : 'The head cannot travel far enough for the camera to see the edge of this area, so the picture stops short of it.',
      };
    case 'stopped':
      return { kind: 'finished', note: `Stopped after ${taken} of ${total} pictures.${kept}` };
    case 'failed':
      return { kind: 'failed', message: `${outcome.message}${kept}` };
  }
}

function clipToBed(
  area: BedArea,
  bed: { readonly width: number; readonly height: number },
): BedArea | null {
  const x0 = Math.max(0, area.x);
  const y0 = Math.max(0, area.y);
  const x1 = Math.min(bed.width, area.x + area.width);
  const y1 = Math.min(bed.height, area.y + area.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

function near(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= ARRIVAL_TOLERANCE_MM && Math.abs(a.y - b.y) <= ARRIVAL_TOLERANCE_MM;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
