import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importPngOffThread, resetPngImportWorkerForTests } from './png-import-worker-client';
import type { PngImportWorkerRequest, PngImportWorkerResponse } from './png-import-worker-protocol';

const abortAsset = vi.hoisted(() => vi.fn<(assetId: string) => Promise<void>>());

vi.mock('./paged-asset-indexeddb', () => ({
  IndexedDbPagedAssetRepository: class {
    abort(assetId: string): Promise<void> {
      return abortAsset(assetId);
    }
  },
}));

class StubWorker {
  static instances: StubWorker[] = [];
  onmessage: ((event: MessageEvent<PngImportWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly posted: PngImportWorkerRequest[] = [];
  readonly transfers: ReadonlyArray<Transferable>[] = [];
  terminated = false;

  constructor() {
    StubWorker.instances.push(this);
  }

  postMessage(request: PngImportWorkerRequest, transfer: Transferable[] = []): void {
    this.posted.push(request);
    this.transfers.push(transfer);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(response: PngImportWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<PngImportWorkerResponse>);
  }

  fail(): void {
    this.onerror?.();
  }
}

function latest(): StubWorker {
  const worker = StubWorker.instances.at(-1);
  if (worker === undefined) throw new Error('no worker');
  return worker;
}

function request(assetId: string, signal?: AbortSignal) {
  return importPngOffThread(streamBlob('png'), {
    assetId,
    lumaAssetId: `${assetId}-luma`,
    sourceName: `${assetId}.png`,
    createdAtEpochMs: 1,
    maxEdge: 8,
    maxPixels: 64,
    ...(signal === undefined ? {} : { signal }),
  });
}

describe('PNG import worker client', () => {
  beforeEach(() => {
    StubWorker.instances = [];
    abortAsset.mockReset();
    abortAsset.mockResolvedValue(undefined);
    vi.stubGlobal('Worker', StubWorker);
  });

  afterEach(async () => {
    await resetPngImportWorkerForTests();
    vi.unstubAllGlobals();
  });

  it('transfers File.stream without posting the original Blob', async () => {
    const blob = streamBlob('png');
    const pending = importPngOffThread(blob, {
      assetId: 'source',
      lumaAssetId: 'luma',
      sourceName: 'source.png',
      createdAtEpochMs: 1,
      maxEdge: 8,
      maxPixels: 64,
    });
    const posted = latest().posted[0];
    expect(posted).toMatchObject({
      kind: 'import-png',
      source: { byteLength: 3, mimeType: '' },
    });
    if (posted?.kind !== 'import-png') throw new Error('expected import request');
    expect(posted).not.toHaveProperty('blob');
    expect(posted.stream).toBeInstanceOf(ReadableStream);
    expect(latest().transfers[0]).toEqual([posted.stream]);
    latest().reply({
      id: posted?.id ?? -1,
      kind: 'complete',
      result: { kind: 'legacy-fallback', reason: 'fixture' },
    });

    await expect(pending).resolves.toEqual({
      kind: 'legacy-fallback',
      reason: 'fixture',
    });
  });

  it('does not open a queued source stream until that request becomes active', async () => {
    const firstBlob = streamBlob('first');
    const secondBlob = streamBlob('second');
    const firstStream = vi.spyOn(firstBlob, 'stream');
    const secondStream = vi.spyOn(secondBlob, 'stream');
    const first = importPngOffThread(firstBlob, options('first'));
    const second = importPngOffThread(secondBlob, options('second'));
    const worker = latest();

    expect(firstStream).toHaveBeenCalledOnce();
    expect(secondStream).not.toHaveBeenCalled();
    worker.reply({
      id: worker.posted[0]?.id ?? -1,
      kind: 'complete',
      result: { kind: 'legacy-fallback', reason: 'first' },
    });
    expect(secondStream).toHaveBeenCalledOnce();
    worker.reply({
      id: worker.posted[1]?.id ?? -1,
      kind: 'complete',
      result: { kind: 'legacy-fallback', reason: 'second' },
    });

    await expect(first).resolves.toMatchObject({ reason: 'first' });
    await expect(second).resolves.toMatchObject({ reason: 'second' });
  });

  it('queues FIFO and relays exact phase progress', async () => {
    const progress = vi.fn();
    const first = request('first');
    const second = importPngOffThread(streamBlob('png'), {
      assetId: 'second',
      lumaAssetId: 'second-luma',
      sourceName: 'second.png',
      createdAtEpochMs: 2,
      maxEdge: 8,
      maxPixels: 64,
      onProgress: progress,
    });
    const worker = latest();
    expect(progress).toHaveBeenCalledWith({ phase: 'queued', queuePosition: 1 });
    worker.reply({
      id: worker.posted[0]?.id ?? -1,
      kind: 'complete',
      result: { kind: 'legacy-fallback', reason: 'first' },
    });
    const secondId = worker.posted[1]?.id ?? -1;
    worker.reply({
      id: secondId,
      kind: 'progress',
      progress: { phase: 'decoding', encodedBytes: 12 },
    });
    expect(progress).toHaveBeenCalledWith({
      phase: 'decoding',
      encodedBytes: 12,
      queuePosition: 0,
    });
    worker.reply({
      id: secondId,
      kind: 'complete',
      result: { kind: 'legacy-fallback', reason: 'second' },
    });
    await expect(first).resolves.toMatchObject({ reason: 'first' });
    await expect(second).resolves.toMatchObject({ reason: 'second' });
  });

  it('terminates active work, cleans both staged assets, then advances FIFO on cancel', async () => {
    const controller = new AbortController();
    const first = request('first', controller.signal);
    const second = request('second');
    const worker = latest();

    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);
    expect(abortAsset.mock.calls).toEqual([['first'], ['first-luma']]);
    const replacement = latest();
    expect(replacement).not.toBe(worker);
    expect(replacement.posted[0]).toMatchObject({ kind: 'import-png' });
    replacement.reply({
      id: replacement.posted[0]?.id ?? -1,
      kind: 'complete',
      result: { kind: 'legacy-fallback', reason: 'second' },
    });
    await expect(second).resolves.toMatchObject({ reason: 'second' });
  });

  it('cleans and rejects only active staging, then resumes queued work after a crash', async () => {
    const first = request('crashed');
    const second = request('queued');
    const worker = latest();

    worker.fail();

    await expect(first).rejects.toThrow('PNG import worker errored');
    expect(worker.terminated).toBe(true);
    expect(abortAsset.mock.calls).toEqual([['crashed'], ['crashed-luma']]);
    const replacement = latest();
    expect(replacement).not.toBe(worker);
    replacement.reply({
      id: replacement.posted[0]?.id ?? -1,
      kind: 'complete',
      result: { kind: 'legacy-fallback', reason: 'queued survived' },
    });
    await expect(second).resolves.toMatchObject({ reason: 'queued survived' });
  });

  it('does not disguise failed cancellation cleanup as an ordinary AbortError', async () => {
    abortAsset.mockRejectedValueOnce(new Error('storage busy'));
    const controller = new AbortController();
    const pending = request('cleanup-failed', controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({
      name: 'PagedAssetCleanupError',
      message: expect.stringContaining('could not be removed'),
    });
  });
});

function options(assetId: string) {
  return {
    assetId,
    lumaAssetId: `${assetId}-luma`,
    sourceName: `${assetId}.png`,
    createdAtEpochMs: 1,
    maxEdge: 8,
    maxPixels: 64,
  };
}

function streamBlob(contents: string): Blob {
  const blob = new Blob([contents]);
  const bytes = new TextEncoder().encode(contents);
  Object.defineProperty(blob, 'stream', {
    configurable: true,
    value: vi.fn(
      () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
    ),
  });
  return blob;
}
