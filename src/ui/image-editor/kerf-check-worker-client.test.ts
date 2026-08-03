import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import type { KerfOutputParity } from './editor-kerf-output-parity';
import type * as kerfCheckClient from './kerf-check-worker-client';
import type {
  KerfCheckWorkerPayload,
  KerfCheckWorkerRequest,
  KerfCheckWorkerResponse,
} from './kerf-check-worker-protocol';

type KerfCheckClient = typeof kerfCheckClient;

type PostedRequest = {
  readonly request: KerfCheckWorkerRequest;
  readonly transfer: ReadonlyArray<Transferable>;
};

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly url: URL;
  readonly options: WorkerOptions;
  readonly posted: PostedRequest[] = [];
  onmessage: ((event: MessageEvent<KerfCheckWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminateCalls = 0;

  constructor(url: URL, options: WorkerOptions) {
    this.url = url;
    this.options = options;
    FakeWorker.instances.push(this);
  }

  postMessage(request: KerfCheckWorkerRequest, transfer: ReadonlyArray<Transferable> = []): void {
    this.posted.push({ request, transfer });
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

function payload(): KerfCheckWorkerPayload {
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

// The client holds one warm worker in module scope, so each test loads its own
// copy of the module rather than inheriting the previous test's worker.
async function loadClient(): Promise<KerfCheckClient> {
  vi.resetModules();
  return import('./kerf-check-worker-client');
}

function currentWorker(): FakeWorker {
  const worker = FakeWorker.instances.at(-1);
  if (worker === undefined) throw new Error('Expected a kerf worker.');
  return worker;
}

function postedIds(worker: FakeWorker): number[] {
  return worker.posted.map((entry) => entry.request.id);
}

function requiredHandle(
  client: KerfCheckClient,
  input: KerfCheckWorkerPayload = payload(),
): kerfCheckClient.KerfCheckWorkerHandle {
  const handle = client.startKerfCheckWorker(input);
  if (handle === null) throw new Error('Expected a kerf worker handle.');
  return handle;
}

function lastPostedId(worker: FakeWorker): number {
  const id = postedIds(worker).at(-1);
  if (id === undefined) throw new Error('Expected a posted kerf request.');
  return id;
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('startKerfCheckWorker', () => {
  it('returns null without Worker support', async () => {
    const client = await loadClient();
    const input = payload();
    const slice = vi.spyOn(input.composite.data, 'slice');
    vi.stubGlobal('Worker', undefined);
    expect(client.startKerfCheckWorker(input)).toBeNull();
    expect(slice).not.toHaveBeenCalled();
  });

  it('returns null when the worker constructor throws', async () => {
    class ThrowingWorker extends FakeWorker {
      constructor(url: URL, options: WorkerOptions) {
        super(url, options);
        throw new Error('worker construction failed');
      }
    }
    vi.stubGlobal('Worker', ThrowingWorker);
    const client = await loadClient();
    const input = payload();
    const slice = vi.spyOn(input.composite.data, 'slice');

    expect(client.startKerfCheckWorker(input)).toBeNull();
    expect(slice).not.toHaveBeenCalled();
  });

  it('returns null when the transferable copy cannot allocate but keeps the worker warm', async () => {
    const client = await loadClient();
    const failing = payload();
    vi.spyOn(failing.composite.data, 'slice').mockImplementation(() => {
      throw new RangeError('allocation failed');
    });

    expect(client.startKerfCheckWorker(failing)).toBeNull();
    expect(currentWorker().terminateCalls).toBe(0);

    const handle = requiredHandle(client);
    currentWorker().respond({ kind: 'ok', id: lastPostedId(currentWorker()), parity: null });
    await expect(handle.result).resolves.toBeNull();
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('uses the module worker URL, transfers the composite, and resolves success', async () => {
    const client = await loadClient();
    const input = payload();
    const handle = requiredHandle(client, input);
    const worker = currentWorker();

    expect(String(worker.url)).toContain('kerf-check-worker.ts');
    expect(worker.options).toEqual({ type: 'module' });
    const posted = worker.posted[0]?.request;
    expect(posted).not.toBe(input);
    expect(posted?.composite.data).not.toBe(input.composite.data);
    expect(posted?.composite.data).toEqual(input.composite.data);
    expect(worker.posted[0]?.transfer).toEqual([posted?.composite.data.buffer]);
    expect(input.composite.data.byteLength).toBe(4);

    const output = parity();
    worker.respond({ kind: 'ok', id: lastPostedId(worker), parity: output });
    await expect(handle.result).resolves.toBe(output);
    expect(worker.terminateCalls).toBe(0);
  });

  it('reuses one warm worker across checks instead of respawning per check', async () => {
    const client = await loadClient();
    const first = requiredHandle(client);
    currentWorker().respond({ kind: 'ok', id: lastPostedId(currentWorker()), parity: parity() });
    await first.result;

    const second = requiredHandle(client);
    currentWorker().respond({ kind: 'ok', id: lastPostedId(currentWorker()), parity: null });
    await expect(second.result).resolves.toBeNull();

    expect(FakeWorker.instances).toHaveLength(1);
    expect(currentWorker().terminateCalls).toBe(0);
    const ids = postedIds(currentWorker());
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('routes each response to the check that owns its id', async () => {
    const client = await loadClient();
    const first = requiredHandle(client);
    const second = requiredHandle(client);
    const worker = currentWorker();
    const [firstId, secondId] = postedIds(worker);
    if (firstId === undefined || secondId === undefined) throw new Error('Expected two requests.');

    const secondParity = parity();
    worker.respond({ kind: 'ok', id: secondId, parity: secondParity });
    worker.respond({ kind: 'ok', id: firstId, parity: null });

    await expect(second.result).resolves.toBe(secondParity);
    await expect(first.result).resolves.toBeNull();
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('rejects a failed analysis without retiring the worker', async () => {
    const client = await loadClient();
    const handle = requiredHandle(client);
    const worker = currentWorker();

    worker.respond({ kind: 'error', id: lastPostedId(worker), message: 'analysis failed' });
    await expect(handle.result).rejects.toThrow('analysis failed');
    expect(worker.terminateCalls).toBe(0);

    const next = requiredHandle(client);
    worker.respond({ kind: 'ok', id: lastPostedId(worker), parity: null });
    await expect(next.result).resolves.toBeNull();
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('rejects a worker runtime failure, retires the worker, and respawns for the next check', async () => {
    const client = await loadClient();
    const handle = requiredHandle(client);
    const failed = currentWorker();

    failed.fail();
    await expect(handle.result).rejects.toThrow('Background kerf check worker errored');
    expect(failed.terminateCalls).toBe(1);

    const next = requiredHandle(client);
    expect(FakeWorker.instances).toHaveLength(2);
    currentWorker().respond({ kind: 'ok', id: lastPostedId(currentWorker()), parity: null });
    await expect(next.result).resolves.toBeNull();
  });

  it('retires the worker when a response cannot be deserialized', async () => {
    const client = await loadClient();
    const handle = requiredHandle(client);
    const worker = currentWorker();

    worker.onmessageerror?.();
    await expect(handle.result).rejects.toThrow('could not be read');
    expect(worker.terminateCalls).toBe(1);
  });

  it('cancels once, resolves null, and drops the late response by id', async () => {
    const client = await loadClient();
    const handle = requiredHandle(client);
    const worker = currentWorker();
    const cancelledId = lastPostedId(worker);

    handle.cancel();
    handle.cancel();
    worker.respond({ kind: 'ok', id: cancelledId, parity: parity() });

    await expect(handle.result).resolves.toBeNull();
    expect(worker.terminateCalls).toBe(0);

    const next = requiredHandle(client);
    worker.respond({ kind: 'ok', id: lastPostedId(worker), parity: null });
    await expect(next.result).resolves.toBeNull();
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('rejects a postMessage failure after retiring the worker', async () => {
    class ThrowingWorker extends FakeWorker {
      override postMessage(): void {
        throw new Error('post failed');
      }
    }
    vi.stubGlobal('Worker', ThrowingWorker);
    const client = await loadClient();
    const handle = requiredHandle(client);

    await expect(handle.result).rejects.toThrow('post failed');
    expect(currentWorker().terminateCalls).toBe(1);
  });
});
