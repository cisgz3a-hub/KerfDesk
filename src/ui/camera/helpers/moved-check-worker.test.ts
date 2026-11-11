// Rolling audit v14 Z1-P2-1 / Z1-P2-2 (ADR-663 Amendment 6, ADR-440
// Amendment 11): the camera-moved check on a camera that has just started,
// and on a held picture, reads its picture in the camera picture worker. A
// stand-in client makes the thumbnail the worker would; the window's own
// capture throws if it is called.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { compareViews } from '../../../core/camera/model/view-motion';
import { viewThumbnail } from '../../../core/camera/model/view-shift';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { resetStore } from '../../state/test-helpers';
import type { PictureClient } from '../picture-worker/camera-picture-client';
import type { PictureRequest } from '../picture-worker/picture-work';
import { captureStill, stillCompanion } from '../still-capture';
import { checkCameraMoved, useCameraMovedStore } from './moved-check';
import { checkStartedCameraMoved } from './moved-check-capture';
import { saveViewReference } from './view-reference';

const source = {
  kind: 'usb' as const,
  stream: {
    stream: {} as MediaStream,
    sourceId: 'overhead',
    resizeMode: 'none' as const,
    stop: vi.fn(),
  },
};
const record = savedCameraModel({
  version: 1,
  sourceKind: 'usb',
  sourceId: 'overhead',
  width: 1280,
  height: 720,
  resizeMode: 'none',
});
const initialCamera = useCameraStore.getState();

const frames = new Map<string, RgbaImage>();
// Smooth shapes everywhere, slid by (dx, dy) camera pixels; drawn once each.
function frame(dx: number, dy: number): RgbaImage {
  const key = `${dx},${dy}`;
  const known = frames.get(key);
  if (known !== undefined) return known;
  const width = 1280;
  const height = 720;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = x - dx;
      const sy = y - dy;
      const v =
        128 +
        40 * Math.sin(0.057 * sx + 0.021 * sy) +
        35 * Math.cos(0.039 * sy - 0.015 * sx) +
        25 * Math.sin(0.093 * sx) * Math.cos(0.069 * sy);
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  const drawn = { width, height, data };
  frames.set(key, drawn);
  return drawn;
}

// A worker client that "sees" `seen`: its thumbnail is the real one, made here.
function workerSeeing(seen: RgbaImage) {
  const requests: PictureRequest[] = [];
  const display = { width: 1280, height: 720, close: vi.fn() } as unknown as ImageBitmap;
  const client: PictureClient = {
    capture: vi.fn(async () => ({ width: 1280, height: 720, close: vi.fn() }) as never),
    run: vi.fn(async (request: PictureRequest) => {
      requests.push(request);
      if (request.op === 'compare-views') {
        return { kind: 'views' as const, comparison: compareViews(request.args) };
      }
      if (request.op !== 'still') return { kind: 'failed' as const };
      return {
        kind: 'still' as const,
        width: seen.width,
        height: seen.height,
        image: request.pixels ? { ...seen, data: new Uint8ClampedArray(seen.data) } : null,
        display: request.displayWidth === null ? null : display,
        thumbnail: request.thumbWidth === null ? null : viewThumbnail(seen, request.thumbWidth),
      };
    }),
  };
  return { client, requests, display };
}

const inWindow = vi.fn(async (): Promise<RgbaImage | null> => {
  throw new Error('the window read a picture');
});

beforeEach(() => {
  localStorage.clear();
  resetStore();
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: { ...project.device, bedWidth: 400, bedHeight: 400, cameraModel: record },
    },
  });
  useCameraStore.setState({ ...initialCamera, sourceState: { kind: 'live', source } });
  useCameraMovedStore.setState({ state: { kind: 'unknown' }, dismissedFor: null, weakChecks: 0 });
  inWindow.mockClear();
});

afterEach(() => {
  useCameraStore.setState(initialCamera);
});

describe('the check on a camera that has just started', { timeout: 20_000 }, () => {
  it('compares the thumbnail the worker made, and never reads the picture in the window', async () => {
    saveViewReference(record, viewThumbnail(frame(0, 0)));
    const steady = workerSeeing(frame(0, 0));
    await checkStartedCameraMoved(source, { client: steady.client, inWindow });
    expect(useCameraMovedStore.getState().state).toEqual({ kind: 'steady' });
    expect(steady.requests).toEqual([
      expect.objectContaining({ op: 'still', pixels: false, displayWidth: null, thumbWidth: 384 }),
      // The two thumbnails are compared in the worker too.
      expect.objectContaining({ op: 'compare-views' }),
    ]);

    const slid = workerSeeing(frame(12, -7));
    await checkStartedCameraMoved(source, { client: slid.client, inWindow });
    expect(useCameraMovedStore.getState().state.kind).toBe('moved');
    expect(inWindow).not.toHaveBeenCalled();
  });

  it('drops a verdict that arrives after the camera was switched', async () => {
    saveViewReference(record, viewThumbnail(frame(0, 0)));
    const slid = workerSeeing(frame(12, -7));
    const run = slid.client.run;
    slid.client = {
      ...slid.client,
      run: async (request) => {
        const reply = await run(request);
        if (request.op === 'compare-views') {
          useCameraStore.setState({ sourceState: { kind: 'live', source: { ...source } } });
        }
        return reply;
      },
    };
    await checkStartedCameraMoved(source, { client: slid.client, inWindow });
    expect(useCameraMovedStore.getState().state).toEqual({ kind: 'unknown' });
  });

  it('takes no picture when there is no view to compare with', async () => {
    const { client } = workerSeeing(frame(0, 0));
    await checkStartedCameraMoved(source, { client, inWindow });
    expect(client.capture).not.toHaveBeenCalled();
    expect(useCameraMovedStore.getState().state).toEqual({ kind: 'unknown' });
  });

  it('reads the picture in the window only where there is no worker', async () => {
    saveViewReference(record, viewThumbnail(frame(0, 0)));
    const window = vi.fn(async () => frame(0, 0));
    await checkStartedCameraMoved(source, { client: null, inWindow: window });
    expect(window).toHaveBeenCalledTimes(1);
    expect(useCameraMovedStore.getState().state).toEqual({ kind: 'steady' });
  });
});

describe('a held picture taken through the worker', { timeout: 20_000 }, () => {
  it('comes with an overlay copy and the thumbnail the check then uses', async () => {
    saveViewReference(record, viewThumbnail(frame(0, 0)));
    const { client, requests, display } = workerSeeing(frame(0, 0));
    const still = await captureStill(source, { client, thumbWidth: 384, inWindow });
    expect(requests).toEqual([
      expect.objectContaining({ op: 'still', pixels: true, displayWidth: 1920, thumbWidth: 384 }),
    ]);
    expect(still?.width).toBe(1280);
    if (still === null) return;
    expect(stillCompanion(still)?.display).toBe(display);
    // Blank the pixels: a steady verdict can then only come from the worker's thumbnail.
    still.data.fill(0);
    expect(checkCameraMoved(source, still)).toEqual({ kind: 'steady' });
    expect(inWindow).not.toHaveBeenCalled();
  });

  it('is taken in the window when the worker fails', async () => {
    const client: PictureClient = {
      capture: vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }) as never),
      run: vi.fn(async () => ({ kind: 'failed' as const })),
    };
    const window = vi.fn(async () => frame(0, 0));
    expect(await captureStill(source, { client, inWindow: window })).toBe(frame(0, 0));
    expect(stillCompanion(frame(0, 0))).toBeUndefined();
  });
});
