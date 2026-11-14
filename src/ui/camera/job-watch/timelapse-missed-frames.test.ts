// Camera audit v2 K4-P2-1 and K4-P3-1 (ADR-490 Amendment 3). Five failed
// captures in a row ended a timelapse for good, and with the bridge's
// back-off two hiccups a second apart were five. A missed frame is now
// skipped and tried again at the next interval; the recording says so, and
// carries on when pictures come back.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { useCameraStore } from '../../state/camera-store';
import { useToastStore } from '../../state/toast-store';
import type { PictureClient } from '../picture-worker/camera-picture-client';
import type { WatchCamera, WatchIo } from './job-watch-camera';
import { useJobWatchStore } from './job-watch-store';
import { MISSED_FRAMES_TO_SAY, startTimelapse } from './timelapse-recorder';

const source = {
  kind: 'machine-jpeg' as const,
  cameraUrl: 'http://camera.invalid/frame',
  frameUrl: 'http://bridge.invalid/frame',
};
const initialCamera = useCameraStore.getState();
const INTERVAL_MS = 1000;

function camera(fixed: boolean): WatchCamera {
  return {
    source,
    fixedModel: fixed ? savedCameraModel() : null,
    surfaceHeightMm: 3,
    heightAreas: [],
    taken: {} as WatchCamera['taken'],
  };
}

// A camera that gives a picture of `size` while `up()` is true; the times of every capture.
function cameraClient(up: () => boolean, size = () => ({ width: 1280, height: 720 })) {
  const captures: number[] = [];
  return {
    captures,
    client: (clock: { now: number }): PictureClient => ({
      capture: vi.fn(async () => {
        captures.push(clock.now);
        return up() ? ({ ...size(), close: vi.fn() } as unknown as ImageBitmap) : null;
      }),
      run: vi.fn(async () => ({
        kind: 'jpeg' as const,
        blob: new Blob(['frame']),
        width: 640,
        height: 360,
      })),
    }),
  };
}

function io(client: PictureClient, clock: { now: number }): WatchIo {
  return {
    captureFrame: vi.fn(async () => null),
    encodeJpeg: vi.fn(async () => null),
    now: () => clock.now,
    wait: async (ms: number) => {
      clock.now += ms;
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    picture: client,
  };
}

// Runs the recorder on a virtual clock until `untilMs`.
async function record(
  args: { camera: WatchCamera; client: PictureClient; clock: { now: number } },
  untilMs: number,
) {
  const recorder = startTimelapse({
    camera: args.camera,
    region: { x: 100, y: 100, width: 120, height: 80 },
    intervalMs: INTERVAL_MS,
    io: io(args.client, args.clock),
    jobRunning: () => true,
    isCurrent: () => true,
  });
  await vi.waitFor(() => expect(args.clock.now).toBeGreaterThanOrEqual(untilMs), {
    timeout: 20_000,
  });
  recorder.stop();
}

beforeEach(() => {
  useCameraStore.setState({ ...initialCamera, sourceState: { kind: 'live', source } });
  useJobWatchStore.setState({ timelapse: null });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  useCameraStore.setState(initialCamera);
});

describe('a timelapse when frames are missed', () => {
  it('skips the missed frames, says so once, and carries on when pictures return', async () => {
    const clock = { now: 0 };
    // Up for 3 s, down for 10 s (a Wi-Fi drop or a stall), up again.
    const camera_ = cameraClient(() => clock.now < 3000 || clock.now >= 13_000);
    await record({ camera: camera(false), client: camera_.client(clock), clock }, 20_000);
    const timelapse = useJobWatchStore.getState().timelapse;
    // Frames before and after the outage: the recording never ended.
    expect(timelapse?.recording).toBe(true);
    expect(timelapse?.frames.length ?? 0).toBeGreaterThan(8);
    // The note came and went; the toast said it once.
    expect(timelapse?.note).toBeNull();
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      expect.stringContaining('frames are being skipped'),
    ]);
  }, 30_000);

  it('tries again at the next interval after a miss, not every 250 ms', async () => {
    const clock = { now: 0 };
    const camera_ = cameraClient(() => false);
    await record({ camera: camera(false), client: camera_.client(clock), clock }, 10_000);
    const gaps = camera_.captures.slice(1).map((at, i) => at - (camera_.captures[i] ?? 0));
    expect(gaps.every((gap) => gap >= INTERVAL_MS)).toBe(true);
    // Still recording, and saying why there are no frames.
    expect(useJobWatchStore.getState().timelapse).toMatchObject({
      recording: true,
      note: expect.stringContaining('frames are being skipped'),
    });
    expect(camera_.captures.length).toBeGreaterThanOrEqual(MISSED_FRAMES_TO_SAY);
  }, 30_000);

  it('skips frames whose size no longer fits a flat recording, at the interval', async () => {
    const clock = { now: 0 };
    // 1280 × 720 for the first frame, then 640 × 480: another shape.
    const camera_ = cameraClient(
      () => true,
      () => (clock.now < 500 ? { width: 1280, height: 720 } : { width: 640, height: 480 }),
    );
    await record({ camera: camera(true), client: camera_.client(clock), clock }, 8000);
    const gaps = camera_.captures.slice(2).map((at, i) => at - (camera_.captures[i + 1] ?? 0));
    expect(gaps.every((gap) => gap >= INTERVAL_MS)).toBe(true);
    expect(useJobWatchStore.getState().timelapse).toMatchObject({
      recording: true,
      note: expect.stringContaining('changed size'),
    });
  }, 30_000);
});
