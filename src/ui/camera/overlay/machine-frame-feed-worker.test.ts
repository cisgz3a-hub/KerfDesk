// Rolling audit v14 Z1-P1-1 (ADR-440 Amendment 11): Chromium shrinks a
// picture on the thread that receives the bitmap, so the overlay's shrink in
// the window held the UI thread 118-243 ms a 4K picture. The default decode
// now shrinks only in the camera picture worker; the window decodes at full
// size, which browsers do off the UI thread. A shrink that would save under a
// tenth of the width is skipped.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveCameraSource } from '../frame-source';
import type { PictureReply, PictureRequest } from '../picture-worker/picture-work';
import { shrinkWidth } from '../picture-worker/picture-size';
import { startMachineFrameFeed, type MachineFrame } from './machine-frame-feed';

const worker = vi.hoisted(() => ({
  present: true,
  requests: [] as Array<{ op: string; resizeWidth?: number }>,
  reply: 'bitmap' as 'bitmap' | 'failed',
}));
vi.mock('../picture-worker/camera-picture-client', () => ({
  pictureClient: () =>
    worker.present
      ? {
          capture: async () => null,
          run: async (request: PictureRequest): Promise<PictureReply> => {
            worker.requests.push(request as never);
            return worker.reply === 'bitmap'
              ? { kind: 'bitmap', bitmap: { width: 1920, close: () => undefined } as never }
              : { kind: 'failed' };
          },
        }
      : null,
}));

// A minimal JPEG declaring width × height.
function jpeg(width: number, height: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);
}

const JPEG_SOURCE = {
  kind: 'machine-jpeg',
  frameUrl: 'http://127.0.0.1:9/frame.jpg',
  cameraUrl: 'http://127.0.0.1:9/frame.jpg',
  pollIntervalMs: 60_000,
} as unknown as ActiveCameraSource;

// Calls of the window's own createImageBitmap, by how many arguments it got.
const windowDecodes: number[] = [];

beforeEach(() => {
  worker.present = true;
  worker.reply = 'bitmap';
  worker.requests.length = 0;
  windowDecodes.length = 0;
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (...args: unknown[]) => {
      windowDecodes.push(args.length);
      return { width: 3840, close: () => undefined };
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

// One polled picture of `width` × `height`, drawn on a canvas `displayWidth` wide.
async function onePicture(width: number, height: number, displayWidth: number) {
  const frames: MachineFrame[] = [];
  const stop = startMachineFrameFeed(JPEG_SOURCE, {
    displayWidth: () => displayWidth,
    minIntervalMs: () => 0,
    fetchImpl: (async () => new Response(jpeg(width, height))) as unknown as typeof fetch,
    onFrame: (frame) => frames.push(frame),
  });
  await vi.waitFor(() => expect(frames).toHaveLength(1));
  stop?.();
  return frames[0];
}

describe('the overlay feed decodes off the UI thread', () => {
  it('shrinks a 4K picture in the picture worker, never in the window', async () => {
    const frame = await onePicture(3840, 2160, 1920);
    expect(worker.requests).toEqual([expect.objectContaining({ op: 'decode', resizeWidth: 1920 })]);
    expect(windowDecodes).toEqual([]);
    expect(frame).toMatchObject({ width: 3840, height: 2160 });
  });

  it('decodes a 1,920 px picture as is for a 1,917 px canvas: no pointless shrink', async () => {
    await onePicture(1920, 1080, 1917);
    expect(worker.requests).toEqual([]);
    // The blob alone: a plain decode, which browsers do off the UI thread.
    expect(windowDecodes).toEqual([1]);
  });

  it('decodes at full size, never shrinking in the window, without the worker', async () => {
    worker.present = false;
    await onePicture(3840, 2160, 1920);
    expect(windowDecodes).toEqual([1]);
  });

  it('decodes at full size when the worker fails', async () => {
    worker.reply = 'failed';
    await onePicture(3840, 2160, 1920);
    expect(worker.requests).toHaveLength(1);
    expect(windowDecodes).toEqual([1]);
  });
});

describe('shrinkWidth', () => {
  it('shrinks only when it saves at least a tenth of the width', () => {
    expect(shrinkWidth(3840, 1920)).toBe(1920);
    expect(shrinkWidth(2560, 1920)).toBe(1920);
    expect(shrinkWidth(1920, 1917)).toBeUndefined();
    expect(shrinkWidth(1920, 1800)).toBeUndefined();
    expect(shrinkWidth(1920, 1340)).toBe(1340);
    expect(shrinkWidth(1280, 4000)).toBeUndefined();
  });
});
