// Rolling audit v13 Y4-P2-1 (ADR-490 Amendment 2): a phone or MCP camera still
// was decoded and encoded on the PC's UI thread, 62-195 ms a 4K still, so a
// client polling it during a job crowded the window Abort is sent from. The
// still is now encoded in the picture worker, and paced: one at a time, at
// most one a second.

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PictureClient } from '../camera/picture-worker/camera-picture-client';
import type { PictureRequest } from '../camera/picture-worker/picture-work';
import { useCameraStore } from '../state/camera-store';
import { cameraSnapshot, resetStillPacing } from './machine-camera';
import type { RemoteControlOptions } from './types';

const worker = vi.hoisted(() => ({
  captures: 0,
  requests: [] as PictureRequest[],
}));
vi.mock('../camera/picture-worker/camera-picture-client', () => {
  const bitmap = () => ({ width: 3840, height: 2160, close: () => undefined });
  const client: PictureClient = {
    capture: async () => {
      worker.captures += 1;
      return bitmap() as unknown as ImageBitmap;
    },
    run: async (request) => {
      worker.requests.push(request);
      return {
        kind: 'jpeg',
        blob: new Blob(['still'], { type: 'image/jpeg' }),
        width: 1024,
        height: 576,
      };
    },
  };
  return { pictureClient: () => client };
});

const options: RemoteControlOptions = {
  canWrite: () => false,
  canShareArtwork: () => true,
  getAppStatus: () => ({
    app: { name: 'KerfDesk', version: '1', platform: 'desktop' },
    edition: { mode: 'free' },
    updates: { available: false },
  }),
};
const authority = () => ({
  clientId: 'client',
  sessionId: 'session',
  signal: new AbortController().signal,
  assertCurrent: () => undefined,
});

beforeEach(() => {
  worker.captures = 0;
  worker.requests.length = 0;
  resetStillPacing();
  useCameraStore.setState(useCameraStore.getInitialState(), true);
  useCameraStore.setState({
    sourceState: {
      kind: 'live',
      source: {
        kind: 'machine-jpeg',
        frameUrl: 'http://127.0.0.1:9/frame.jpg',
        cameraUrl: 'http://127.0.0.1:9/frame.jpg',
      },
    } as never,
  });
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 3840, height: 2160, close: () => undefined })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('encodes the still in the picture worker, at most 1024 px', async () => {
  const result = await cameraSnapshot(options, authority());
  expect(result).toMatchObject({
    status: 'ready',
    image: { mimeType: 'image/jpeg', widthPx: 1024, heightPx: 576 },
  });
  expect(btoa('still')).toBe((result as { image: { data: string } }).image.data);
  expect(worker.requests).toEqual([
    expect.objectContaining({ op: 'jpeg', maxSidePx: 1024, quality: 0.8 }),
  ]);
});

it('takes one still for requests that overlap, and waits a second before the next', async () => {
  const [a, b] = await Promise.all([
    cameraSnapshot(options, authority()),
    cameraSnapshot(options, authority()),
  ]);
  expect(a).toBe(b);
  expect(worker.captures).toBe(1);
  const startedAt = Date.now();
  await cameraSnapshot(options, authority());
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
  expect(worker.captures).toBe(2);
});
