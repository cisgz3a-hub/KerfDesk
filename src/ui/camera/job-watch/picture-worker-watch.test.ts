// Rolling audit v13 Y4-P1-1 (ADR-490 Amendment 2): while a job runs, job
// watch reads, flattens and encodes its pictures in the picture worker, not
// on the UI thread Abort is sent from. A stand-in worker client records what
// the window asks of it; the window itself never touches a pixel.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { useCameraStore } from '../../state/camera-store';
import type { PictureClient } from '../picture-worker/camera-picture-client';
import type { PictureReply, PictureRequest } from '../picture-worker/picture-work';
import { takeBeforePicture } from './burn-check-run';
import { UNSEEN_REGION_MESSAGE, type WatchCamera, type WatchIo } from './job-watch-camera';
import { useJobWatchStore } from './job-watch-store';
import { startTimelapse } from './timelapse-recorder';

const source = {
  kind: 'usb' as const,
  stream: {
    stream: {} as MediaStream,
    sourceId: 'overhead',
    resizeMode: 'none' as const,
    stop: vi.fn(),
  },
};
const initialCamera = useCameraStore.getState();

function bitmap(width = 1280, height = 720): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

// A worker client that answers each request with `reply`, recording the requests.
function fakeClient(reply: (request: PictureRequest) => PictureReply) {
  const requests: PictureRequest[] = [];
  const client: PictureClient = {
    capture: vi.fn(async () => bitmap()),
    run: vi.fn(async (request: PictureRequest) => {
      requests.push(request);
      return reply(request);
    }),
  };
  return { client, requests };
}

function camera(fixed: boolean): WatchCamera {
  return {
    source,
    fixedModel: fixed ? savedCameraModel() : null,
    surfaceHeightMm: 3,
    heightAreas: [],
    taken: {} as WatchCamera['taken'],
  };
}

// No in-window capture or encode may run while the worker is there.
function io(client: PictureClient, clock: { now: number }): WatchIo {
  return {
    captureFrame: vi.fn(async () => {
      throw new Error('the window decoded a frame');
    }),
    encodeJpeg: vi.fn(async () => {
      throw new Error('the window encoded a frame');
    }),
    now: () => clock.now,
    wait: async () => {
      clock.now += 1000;
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    picture: client,
  };
}

const REGION = { x: 100, y: 100, width: 120, height: 80 };

beforeEach(() => {
  useCameraStore.setState({ ...initialCamera, sourceState: { kind: 'live', source } });
  useJobWatchStore.setState({ timelapse: null });
});

afterEach(() => {
  useCameraStore.setState(initialCamera);
});

describe('the timelapse while a job runs', () => {
  it('has the worker flatten and encode each frame of a calibrated camera', async () => {
    const jpeg = new Blob(['jpeg']);
    const { client, requests } = fakeClient(() => ({
      kind: 'jpeg',
      blob: jpeg,
      width: 640,
      height: 480,
    }));
    const clock = { now: 0 };
    const recorder = startTimelapse({
      camera: camera(true),
      region: REGION,
      intervalMs: 1000,
      io: io(client, clock),
      jobRunning: () => true,
      isCurrent: () => true,
    });
    await vi.waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(2));
    recorder.stop();
    const [first] = requests;
    expect(first).toMatchObject({ op: 'jpeg', flatten: { region: REGION } });
    expect(useJobWatchStore.getState().timelapse?.frames.length).toBeGreaterThanOrEqual(2);
  });

  it('records plain frames for an uncalibrated camera, still in the worker', async () => {
    const { client, requests } = fakeClient(() => ({
      kind: 'jpeg',
      blob: new Blob(['jpeg']),
      width: 640,
      height: 360,
    }));
    const recorder = startTimelapse({
      camera: camera(false),
      region: REGION,
      intervalMs: 1000,
      io: io(client, { now: 0 }),
      jobRunning: () => true,
      isCurrent: () => true,
    });
    await vi.waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(1));
    recorder.stop();
    expect(requests[0]).toMatchObject({ op: 'jpeg' });
    expect(requests[0]).not.toHaveProperty('flatten');
  });

  it('turns plain when the first frame cannot be flattened, as before', async () => {
    const { client, requests } = fakeClient((request) =>
      request.op === 'jpeg' && request.flatten !== undefined
        ? { kind: 'unseen' }
        : { kind: 'jpeg', blob: new Blob(['plain']), width: 640, height: 360 },
    );
    const recorder = startTimelapse({
      camera: camera(true),
      region: REGION,
      intervalMs: 1000,
      io: io(client, { now: 0 }),
      jobRunning: () => true,
      isCurrent: () => true,
    });
    await vi.waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(2));
    recorder.stop();
    expect(requests[0]).toHaveProperty('flatten');
    expect(requests[1]).not.toHaveProperty('flatten');
    expect(useJobWatchStore.getState().timelapse?.flat).toBe(false);
  });
});

describe('the burn check picture at Start', () => {
  const plan = { machineKind: 'laser', manifest: { blocks: [] } } as unknown as Parameters<
    typeof takeBeforePicture
  >[0]['plan'];

  it('is flattened in the worker and kept for the comparison at the end', async () => {
    const image = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
    const { client, requests } = fakeClient(() => ({ kind: 'flat-image', image }));
    const before = await takeBeforePicture({
      plan,
      region: REGION,
      camera: camera(true),
      io: io(client, { now: 0 }),
      headNow: () => null,
      confirmedRouteMm: () => 0,
    });
    expect(requests).toEqual([
      expect.objectContaining({
        op: 'flat-image',
        flatten: expect.objectContaining({ region: REGION }),
      }),
    ]);
    expect(before.kind === 'ok' && before.watch.before).toBe(image);
  });

  it('says when the camera does not see the job', async () => {
    const { client } = fakeClient(() => ({ kind: 'unseen' }));
    const before = await takeBeforePicture({
      plan,
      region: REGION,
      camera: camera(true),
      io: io(client, { now: 0 }),
      headNow: () => null,
      confirmedRouteMm: () => 0,
    });
    expect(before).toEqual({ kind: 'unavailable', reason: UNSEEN_REGION_MESSAGE });
  });
});
