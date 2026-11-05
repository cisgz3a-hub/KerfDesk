// Perf audit S1, S5-P3-3: the trace dialog's decode reads its canvas back in a
// worker. The window draws and snapshots the canvas, nothing more.

import type * as ImageLoader from './image-loader';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RawImageData } from '../../core/trace';
import {
  compositeRgbOverWhitePreservingAlpha,
  compositedPixelsFromDrawnImage,
} from './composited-pixels';
import { decodeTraceSourceImage } from './off-thread-trace-decode';

const loader = vi.hoisted(() => ({ readBacks: 0, loads: 0 }));

vi.mock('./image-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof ImageLoader>();
  return {
    ...actual,
    decodeImageOntoCanvas: async <T>(
      _file: File,
      _maxEdge: number,
      read: (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => T,
    ): Promise<T> => {
      const ctx = {
        getImageData: () => {
          loader.readBacks += 1;
          return { width: 1, height: 1, data: new Uint8ClampedArray(4) };
        },
      } as unknown as CanvasRenderingContext2D;
      return read({ width: 1, height: 1 } as HTMLCanvasElement, ctx);
    },
    loadImageAsRawData: async (): Promise<RawImageData> => {
      loader.loads += 1;
      return { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) };
    },
  };
});

class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: Array<{ message: unknown; transfer: unknown }> = [];
  terminated = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(message: unknown, transfer: unknown): void {
    this.posted.push({ message, transfer });
    const pixels = { width: 1, height: 1, data: new Uint8ClampedArray([10, 20, 30, 255]) };
    queueMicrotask(() =>
      this.onmessage?.({
        data: { kind: 'ok', image: pixels, hasTransparency: false },
      } as MessageEvent),
    );
  }
  terminate(): void {
    this.terminated = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  loader.readBacks = 0;
  loader.loads = 0;
});

describe('trace dialog decode (perf audit S5-P3-3)', () => {
  it('reads the loader’s canvas back in a worker, not in the window', async () => {
    const bitmap = { width: 1, height: 1, close: vi.fn() };
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('OffscreenCanvas', vi.fn());
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    const decoded = await decodeTraceSourceImage(new File(['x'], 'photo.png'), 4096);
    expect(loader.readBacks).toBe(0);
    expect(loader.loads).toBe(0);
    expect(FakeWorker.last?.posted[0]).toEqual({ message: { bitmap }, transfer: [bitmap] });
    expect(FakeWorker.last?.terminated).toBe(true);
    expect(decoded.image.data).toEqual(new Uint8ClampedArray([10, 20, 30, 255]));
  });

  it('decodes in the window where no worker route exists', async () => {
    vi.stubGlobal('Worker', undefined);
    const decoded = await decodeTraceSourceImage(new File(['x'], 'photo.png'), 4096);
    expect(loader.loads).toBe(1);
    expect(decoded.hasTransparency).toBe(false);
  });

  it('composites the snapshot exactly as the loader composites its canvas', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 0, 200, 100, 50, 128, 1, 2, 3, 255]);
    const read = compositedPixelsFromDrawnImage(
      { width: 3, height: 1, close: () => undefined } as unknown as ImageBitmap,
      () => ({ drawImage: () => undefined, getImageData: () => ({ width: 3, height: 1, data }) }),
    );
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(read.image).toEqual(compositeRgbOverWhitePreservingAlpha({ width: 3, height: 1, data }));
    expect(read.hasTransparency).toBe(true);
  });
});
