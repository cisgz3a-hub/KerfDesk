// Watching a whole job with the camera (ADR-490): a laser fill job starts,
// the timelapse records while it runs, the job finishes, and the burn check
// compares the pictures before and after against the job's path. The camera
// frames are rendered from a model of the bed through a calibrated camera
// fixed over it, so the pictures go through the same flattening as real ones.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraCaptureBinding } from '../../../core/camera/camera-capture-binding';
import { bedMapper } from '../../../core/camera/model/camera-model';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { buildMotionManifest } from '../../../core/job/motion-manifest';
import { fingerprintGcode } from '../../../core/recovery';
import { useStore } from '../../state';
import {
  startLiveCanvasRun,
  type CanvasMotionPlan,
  type LiveCanvasLifecycle,
} from '../../state/canvas-motion-plan';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { burnRegion } from './job-burn-route';
import type { WatchIo } from './job-watch-camera';
import { installJobWatch } from './job-watch-runner';
import { DEFAULT_JOB_WATCH_SETTINGS } from './job-watch-settings';
import { useJobWatchStore } from './job-watch-store';

const initialLaser = useLaserStore.getState();
const capture: CameraCaptureBinding = {
  version: 1,
  sourceKind: 'usb',
  sourceId: 'overhead',
  width: 1280,
  height: 720,
  resizeMode: 'none',
};
const model = savedCameraModel(capture);
const source = {
  kind: 'usb' as const,
  stream: {
    stream: {} as MediaStream,
    sourceId: 'overhead',
    resizeMode: 'none' as const,
    stop: () => undefined,
  },
};

// A 30 × 14 mm fill, hatched every 0.5 mm.
const FILL_GCODE = ['G21', 'G90', 'M4 S0', 'G0 X185 Y193']
  .concat(
    Array.from({ length: 29 }, (_, row) => {
      const y = (193 + row * 0.5).toFixed(2);
      return [`G0 Y${y}`, row % 2 === 0 ? 'G1 X215 S800' : 'G1 X185 S800'];
    }).flat(),
  )
  .join('\n');

function fillPlan(): CanvasMotionPlan {
  return {
    manifest: buildMotionManifest(FILL_GCODE, { machineKind: 'laser' }),
    fingerprint: fingerprintGcode(FILL_GCODE),
    retentionKey: 'job-watch-fill',
    machineKind: 'laser',
    device: { ...DEFAULT_DEVICE_PROFILE, bedWidth: 400, bedHeight: 400, origin: 'rear-left' },
    coordinateFrame: { kind: 'machine', workOffsetMm: { x: 0, y: 0, z: 0 } },
    framePerimeter: [],
    jobStart: null,
    approachFrom: null,
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: 0,
  };
}

type Box = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

/** What the overhead camera sees of plywood, burned inside `burned`. */
function cameraFrame(burned: Box | null): RgbaImage {
  const { lens, pose } = model;
  const toBed = bedMapper(lens, pose);
  const data = new Uint8ClampedArray(lens.imageWidth * lens.imageHeight * 4);
  for (let y = 0; y < lens.imageHeight; y += 1) {
    for (let x = 0; x < lens.imageWidth; x += 1) {
      const bed = toBed({ x, y });
      let value = 0;
      if (bed !== null) {
        const inBurn =
          burned !== null &&
          bed.x >= burned.x0 &&
          bed.x <= burned.x1 &&
          bed.y >= burned.y0 &&
          bed.y <= burned.y1;
        value = inBurn ? 60 : 185 + 10 * Math.sin(bed.x / 3);
      }
      data.set([value, value * 0.88, value * 0.7, 255], (y * lens.imageWidth + x) * 4);
    }
  }
  return { data, width: lens.imageWidth, height: lens.imageHeight };
}

let frame: RgbaImage | null = null;
let encodedSizes: string[] = [];
let clock = 0;
const io: WatchIo = {
  captureFrame: () => Promise.resolve(frame),
  encodeJpeg: (image) => {
    encodedSizes.push(`${image.width}x${image.height}`);
    return Promise.resolve(new Blob(['jpeg']));
  },
  now: () => clock,
  wait: (ms) => {
    clock += ms;
    return new Promise((resolve) => setTimeout(resolve, 0));
  },
};

let uninstall: () => void = () => undefined;

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaser, true);
  const project = useStore.getState().project;
  useStore.setState({
    project: { ...project, device: { ...project.device, cameraModel: model } },
  });
  useCameraStore.setState({
    sourceState: { kind: 'live', source },
    bedPicture: null,
    overlayVisible: false,
    surfaceHeightMm: 0,
    heightAreas: [],
  });
  useJobWatchStore.setState({
    settings: {
      ...DEFAULT_JOB_WATCH_SETTINGS,
      timelapse: true,
      intervalSeconds: 2,
      burnCheck: true,
    },
    timelapse: null,
    burnCheck: { kind: 'idle' },
  });
  clock = 0;
  encodedSizes = [];
  frame = cameraFrame(null);
  uninstall = installJobWatch(io);
});

afterEach(() => uninstall());

function setLifecycle(plan: CanvasMotionPlan, lifecycle: LiveCanvasLifecycle): void {
  const run = useLaserStore.getState().liveCanvasRun;
  if (run?.plan !== plan) throw new Error('no run');
  useLaserStore.setState({ liveCanvasRun: { ...run, lifecycle } });
}

/** Where the fill lands on the bed: its region without the watch margin. */
function fillOnBed(plan: CanvasMotionPlan): Box {
  const region = burnRegion(plan);
  if (region === null) throw new Error('no region');
  return {
    x0: region.x + 10,
    y0: region.y + 10,
    x1: region.x + region.width - 10,
    y1: region.y + region.height - 10,
  };
}

describe('watching a job with the camera', () => {
  it('records a timelapse and finds the fill burned where the job put it', async () => {
    const plan = fillPlan();
    useLaserStore.setState({ liveCanvasRun: startLiveCanvasRun(plan, 1000) });
    expect(useJobWatchStore.getState().burnCheck.kind).toBe('watching');
    await vi.waitFor(() =>
      expect(useJobWatchStore.getState().timelapse?.frames.length).toBeGreaterThanOrEqual(2),
    );

    const fill = fillOnBed(plan);
    // The beam spreads a little past the path.
    frame = cameraFrame({
      x0: fill.x0 - 0.4,
      y0: fill.y0 - 0.4,
      x1: fill.x1 + 0.4,
      y1: fill.y1 + 0.4,
    });
    setLifecycle(plan, 'finished');
    await vi.waitFor(() => expect(useJobWatchStore.getState().burnCheck.kind).toBe('done'), {
      timeout: 5000,
    });

    const view = useJobWatchStore.getState().burnCheck;
    if (view.kind !== 'done') return;
    expect(view.report.coverage).toBeGreaterThan(0.97);
    expect(view.report.strayMarks).toBe(0);
    const timelapse = useJobWatchStore.getState().timelapse;
    expect(timelapse?.recording).toBe(false);
    expect(timelapse?.flat).toBe(true);
    // The camera sees the fill square-on: the frames are flat pictures of the job area.
    expect(encodedSizes.at(-1)).toBe(`${50 * 4}x${34 * 4}`);
    expect(useCameraStore.getState().bedPicture).toBe(view.picture);
    expect(useCameraStore.getState().overlayVisible).toBe(true);
  });

  it('shows the part of the fill that did not burn', async () => {
    const plan = fillPlan();
    useLaserStore.setState({ liveCanvasRun: startLiveCanvasRun(plan, 1000) });
    const fill = fillOnBed(plan);
    // Only the left half burned (the laser lost power half way).
    frame = cameraFrame({ ...fill, x1: (fill.x0 + fill.x1) / 2 });
    setLifecycle(plan, 'finished');
    await vi.waitFor(() => expect(useJobWatchStore.getState().burnCheck.kind).toBe('done'), {
      timeout: 5000,
    });
    const view = useJobWatchStore.getState().burnCheck;
    if (view.kind !== 'done') return;
    expect(view.report.coverage).toBeGreaterThan(0.4);
    expect(view.report.coverage).toBeLessThan(0.6);
  });

  it('does not check a job that was stopped', async () => {
    const plan = fillPlan();
    useLaserStore.setState({ liveCanvasRun: startLiveCanvasRun(plan, 1000) });
    setLifecycle(plan, 'stopped');
    await vi.waitFor(() => expect(useJobWatchStore.getState().timelapse?.recording).toBe(false), {
      timeout: 5000,
    });
    expect(useJobWatchStore.getState().burnCheck).toEqual({
      kind: 'unavailable',
      reason: 'The job did not finish, so there is nothing to check.',
    });
  });

  it('says so when the camera was not running as the job started', () => {
    useCameraStore.setState({ sourceState: { kind: 'idle' } });
    useLaserStore.setState({ liveCanvasRun: startLiveCanvasRun(fillPlan(), 1000) });
    const { timelapse, burnCheck } = useJobWatchStore.getState();
    expect(timelapse?.note).toMatch(/not running when the job started/);
    expect(burnCheck).toEqual({
      kind: 'unavailable',
      reason: 'The camera was not running when the job started.',
    });
  });

  it('leaves jobs alone while watching is off', () => {
    useJobWatchStore.setState({ settings: DEFAULT_JOB_WATCH_SETTINGS });
    useLaserStore.setState({ liveCanvasRun: startLiveCanvasRun(fillPlan(), 1000) });
    expect(useJobWatchStore.getState().timelapse).toBeNull();
    expect(useJobWatchStore.getState().burnCheck).toEqual({ kind: 'idle' });
  });
});
