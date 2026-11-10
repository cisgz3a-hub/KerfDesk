// ADR-440 Amendment 10 (rolling audit v13 Y4-P1-2): a bridge camera's
// pictures reach the overlay one decode at a time, newest first, at the
// canvas's width, and only when a new picture arrived.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveCameraSource } from '../frame-source';
import { startMachineFrameFeed, type MachineFrame } from './machine-frame-feed';

// A minimal JPEG declaring width × height, with a body `tag` bytes long, so
// its size says which picture it is.
function jpeg(width: number, height: number, tag: number): Uint8Array {
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
    ...new Array<number>(tag).fill(7),
    0xff,
    0xd9,
  ]);
}

function part(bytes: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(`--ffmpeg\r\nContent-Length: ${bytes.length}\r\n\r\n`);
  return new Uint8Array([...head, ...bytes, 13, 10]);
}

const RTSP = {
  kind: 'machine-rtsp',
  frameUrl: 'http://127.0.0.1:9/frame.jpg',
  previewUrl: 'http://127.0.0.1:9/preview.mjpg',
  liveness: { kind: 'unmonitored', advisory: 'stub' },
  sourceId: 'rtsp://127.0.0.1/stub',
} as unknown as ActiveCameraSource;

// A stream the test feeds chunk by chunk.
function controlledStream(): {
  readonly body: ReadableStream<Uint8Array>;
  push(chunk: Uint8Array): void;
} {
  let enqueue: (chunk: Uint8Array) => void = () => undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      enqueue = (chunk) => controller.enqueue(chunk);
    },
  });
  return { body, push: (chunk) => enqueue(chunk) };
}

function bitmap(): ImageBitmap {
  return { close: vi.fn() } as unknown as ImageBitmap;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('startMachineFrameFeed', () => {
  it('decodes each new picture once, at the display width, keeping only the newest while busy', async () => {
    vi.useRealTimers();
    const stream = controlledStream();
    const decodes: Array<{ tag: number; width: number | undefined; finish: () => void }> = [];
    const frames: MachineFrame[] = [];
    let clock = 0;
    const stop = startMachineFrameFeed(RTSP, {
      displayWidth: () => 1280,
      minIntervalMs: () => 0,
      now: () => clock,
      fetchImpl: (async () => new Response(stream.body)) as typeof fetch,
      decode: (blob, width) =>
        new Promise<ImageBitmap>((resolve) => {
          // 17 bytes of header and end marker, then the tag's body.
          decodes.push({ tag: blob.size - 17, width, finish: () => resolve(bitmap()) });
        }),
      onFrame: (frame) => frames.push(frame),
    });
    stream.push(part(jpeg(3840, 2160, 1)));
    await vi.waitFor(() => expect(decodes).toHaveLength(1));
    expect(decodes[0]).toMatchObject({ tag: 1, width: 1280 });
    // Three more arrive while the first decodes: only the newest is decoded next.
    stream.push(part(jpeg(3840, 2160, 2)));
    stream.push(part(jpeg(3840, 2160, 3)));
    stream.push(part(jpeg(3840, 2160, 4)));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(decodes).toHaveLength(1);
    decodes[0]?.finish();
    clock += 10;
    await vi.waitFor(() => expect(decodes).toHaveLength(2));
    expect(decodes[1]?.tag).toBe(4);
    decodes[1]?.finish();
    await vi.waitFor(() => expect(frames).toHaveLength(2));
    // The camera model's size, not the bitmap's.
    expect(frames[0]).toMatchObject({ width: 3840, height: 2160 });
    stop?.();
  });

  it('waits the job interval between pictures', async () => {
    const stream = controlledStream();
    const decoded: number[] = [];
    let clock = 0;
    const stop = startMachineFrameFeed(RTSP, {
      displayWidth: () => 4000,
      minIntervalMs: () => 500,
      now: () => clock,
      fetchImpl: (async () => new Response(stream.body)) as typeof fetch,
      decode: async (_blob, width) => {
        decoded.push(clock);
        // Already narrower than the display: decoded at its own size.
        expect(width).toBeUndefined();
        return bitmap();
      },
      onFrame: () => undefined,
    });
    stream.push(part(jpeg(1920, 1080, 1)));
    await vi.waitFor(() => expect(decoded).toEqual([0]));
    clock = 100;
    stream.push(part(jpeg(1920, 1080, 2)));
    await vi.advanceTimersByTimeAsync(100);
    expect(decoded).toEqual([0]);
    clock = 500;
    await vi.advanceTimersByTimeAsync(400);
    expect(decoded).toEqual([0, 500]);
    stop?.();
  });

  it('does not feed a USB camera, whose video draws itself', () => {
    const usb = { kind: 'usb' } as unknown as ActiveCameraSource;
    expect(
      startMachineFrameFeed(usb, {
        displayWidth: () => 1,
        minIntervalMs: () => 0,
        onFrame: () => undefined,
      }),
    ).toBeNull();
  });
});
