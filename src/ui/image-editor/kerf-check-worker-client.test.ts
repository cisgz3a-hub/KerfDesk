import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import type { KerfOutputParity } from './editor-kerf-output-parity';
import { startKerfCheckWorker } from './kerf-check-worker-client';
import type { KerfCheckWorkerRequest, KerfCheckWorkerResponse } from './kerf-check-worker-protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly url: URL;
  readonly options: WorkerOptions;
  onmessage: ((event: MessageEvent<KerfCheckWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  posted:
    | {
        readonly request: KerfCheckWorkerRequest;
        readonly transfer: ReadonlyArray<Transferable>;
      }
    | undefined;
  terminateCalls = 0;

  constructor(url: URL, options: WorkerOptions) {
    this.url = url;
    this.options = options;
    FakeWorker.instances.push(this);
  }

  postMessage(request: KerfCheckWorkerRequest, transfer: ReadonlyArray<Transferable> = []): void {
    this.posted = { request, transfer };
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  respond(response: KerfCheckWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<KerfCheckWorkerResponse>);
  }

  fail(): void {
    this.onerror?.();
  }
}

const BOUNDS = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

function request(): KerfCheckWorkerRequest {
  const base = createProject();
  const object: RasterImage = {
    kind: 'raster-image',
    id: 'worker-raster',
    source: 'worker.png',
    dataUrl: 'data:image/png;base64,worker',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: BOUNDS,
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 1,
    lumaBase64: '/w==',
  };
  return {
    composite: {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([255, 255, 255, 255]),
    },
    object,
    layers: [
      {
        ...createLayer({ id: 'worker-layer', color: object.color, mode: 'image' }),
        dotWidthCorrectionMm: 0.5,
      },
    ],
    maskObject: null,
    device: base.device,
    appliedBounds: BOUNDS,
  };
}

function parity(): KerfOutputParity {
  return {
    removedPixels: 1,
    minCorrectionMm: 0.5,
    maxCorrectionMm: 0.5,
    thickenCandidate: null,
  };
}

function lastWorker(): FakeWorker {
  const worker = FakeWorker.instances.at(-1);
  if (worker === undefined) throw new Error('Expected a kerf worker.');
  return worker;
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('startKerfCheckWorker', () => {
  it('returns null without Worker support', () => {
    const input = request();
    const slice = vi.spyOn(input.composite.data, 'slice');
    vi.stubGlobal('Worker', undefined);
    expect(startKerfCheckWorker(input)).toBeNull();
    expect(slice).not.toHaveBeenCalled();
  });

  it('retires the worker and returns null when the transferable copy cannot allocate', () => {
    const input = request();
    vi.spyOn(input.composite.data, 'slice').mockImplementation(() => {
      throw new RangeError('allocation failed');
    });

    expect(startKerfCheckWorker(input)).toBeNull();
    expect(lastWorker().terminateCalls).toBe(1);
  });

  it('uses the module worker URL, transfers the composite, and resolves success', async () => {
    const input = request();
    const handle = startKerfCheckWorker(input);
    if (handle === null) throw new Error('Expected a kerf worker handle.');
    const worker = lastWorker();

    expect(String(worker.url)).toContain('kerf-check-worker.ts');
    expect(worker.options).toEqual({ type: 'module' });
    const posted = worker.posted?.request;
    expect(posted).not.toBe(input);
    expect(posted?.composite.data).not.toBe(input.composite.data);
    expect(posted?.composite.data).toEqual(input.composite.data);
    expect(worker.posted?.transfer).toEqual([posted?.composite.data.buffer]);
    expect(input.composite.data.byteLength).toBe(4);

    const output = parity();
    worker.respond({ kind: 'ok', parity: output });
    await expect(handle.result).resolves.toBe(output);
    expect(worker.terminateCalls).toBe(1);
  });

  it('rejects a worker error response and retires the worker', async () => {
    const handle = startKerfCheckWorker(request());
    if (handle === null) throw new Error('Expected a kerf worker handle.');
    const worker = lastWorker();

    worker.respond({ kind: 'error', message: 'analysis failed' });
    await expect(handle.result).rejects.toThrow('analysis failed');
    expect(worker.terminateCalls).toBe(1);
  });

  it('rejects a worker runtime failure and retires the worker', async () => {
    const handle = startKerfCheckWorker(request());
    if (handle === null) throw new Error('Expected a kerf worker handle.');
    const worker = lastWorker();

    worker.fail();
    await expect(handle.result).rejects.toThrow('Background kerf check worker errored');
    expect(worker.terminateCalls).toBe(1);
  });

  it('cancels once, resolves null, and ignores a late response', async () => {
    const handle = startKerfCheckWorker(request());
    if (handle === null) throw new Error('Expected a kerf worker handle.');
    const worker = lastWorker();

    handle.cancel();
    handle.cancel();
    worker.respond({ kind: 'ok', parity: parity() });

    await expect(handle.result).resolves.toBeNull();
    expect(worker.terminateCalls).toBe(1);
  });

  it('rejects a postMessage failure after retiring the worker', async () => {
    class ThrowingWorker extends FakeWorker {
      override postMessage(): void {
        throw new Error('post failed');
      }
    }
    vi.stubGlobal('Worker', ThrowingWorker);

    const handle = startKerfCheckWorker(request());
    if (handle === null) throw new Error('Expected a kerf worker handle.');

    await expect(handle.result).rejects.toThrow('post failed');
    expect(lastWorker().terminateCalls).toBe(1);
  });
});
