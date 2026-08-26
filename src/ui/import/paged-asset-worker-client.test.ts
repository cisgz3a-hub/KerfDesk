import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPagedAssetWorkerForTests, stageAssetOffThread } from './paged-asset-worker-client';
import type {
  PagedAssetWorkerRequest,
  PagedAssetWorkerResponse,
} from './paged-asset-worker-protocol';

class StubWorker {
  static instances: StubWorker[] = [];
  onmessage: ((event: MessageEvent<PagedAssetWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly posted: PagedAssetWorkerRequest[] = [];
  terminated = false;

  constructor() {
    StubWorker.instances.push(this);
  }

  postMessage(request: PagedAssetWorkerRequest): void {
    this.posted.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(response: PagedAssetWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<PagedAssetWorkerResponse>);
  }
}

function latest(): StubWorker {
  const worker = StubWorker.instances.at(-1);
  if (worker === undefined) throw new Error('no worker');
  return worker;
}

function stage(blob: Blob, assetId: string, signal?: AbortSignal) {
  return stageAssetOffThread(blob, {
    assetId,
    sourceName: `${assetId}.bin`,
    createdAtEpochMs: 1,
    ...(signal === undefined ? {} : { signal }),
  });
}

describe('paged asset worker client', () => {
  beforeEach(() => {
    StubWorker.instances = [];
    vi.stubGlobal('Worker', StubWorker);
  });

  afterEach(() => {
    resetPagedAssetWorkerForTests();
    vi.unstubAllGlobals();
  });

  it('posts the Blob itself without reading it on the UI thread', async () => {
    const blob = new Blob(['fixture']);
    const pending = stage(blob, 'asset-one');
    const request = latest().posted[0];

    expect(request).toMatchObject({ kind: 'stage', blob });
    if (request?.kind !== 'stage') throw new Error('expected stage request');
    latest().reply({
      id: request.id,
      kind: 'complete',
      manifest: {
        schemaVersion: 1,
        assetId: 'asset-one',
        sourceName: 'asset-one.bin',
        mimeType: '',
        byteLength: 7,
        writtenByteLength: 7,
        pageBytes: 1024 * 1024,
        pageCount: 1,
        createdAtEpochMs: 1,
        state: 'ready',
      },
    });

    await expect(pending).resolves.toMatchObject({ assetId: 'asset-one', state: 'ready' });
  });

  it('queues requests FIFO and reports worker byte progress', async () => {
    const progress = vi.fn();
    const first = stage(new Blob(['first']), 'first');
    const second = stageAssetOffThread(new Blob(['second']), {
      assetId: 'second',
      sourceName: 'second.bin',
      createdAtEpochMs: 2,
      onProgress: progress,
    });
    const worker = latest();

    expect(worker.posted).toHaveLength(1);
    expect(progress).toHaveBeenCalledWith({ phase: 'queued', queuePosition: 1 });
    const firstId = worker.posted[0]?.id ?? -1;
    worker.reply({
      id: firstId,
      kind: 'complete',
      manifest: {
        schemaVersion: 1,
        assetId: 'first',
        sourceName: 'first.bin',
        mimeType: '',
        byteLength: 5,
        writtenByteLength: 5,
        pageBytes: 1024 * 1024,
        pageCount: 1,
        createdAtEpochMs: 1,
        state: 'ready',
      },
    });
    const secondId = worker.posted[1]?.id ?? -1;
    worker.reply({
      id: secondId,
      kind: 'progress',
      progress: {
        phase: 'persisting',
        bytesProcessed: 3,
        totalBytes: 6,
        pageIndex: 0,
        pageCount: 1,
      },
    });

    expect(progress).toHaveBeenCalledWith({
      phase: 'persisting',
      bytesProcessed: 3,
      totalBytes: 6,
      pageIndex: 0,
      pageCount: 1,
      queuePosition: 0,
    });
    worker.reply({ id: secondId, kind: 'error', message: 'fixture complete' });
    await expect(first).resolves.toMatchObject({ assetId: 'first' });
    await expect(second).rejects.toThrow('fixture complete');
  });

  it('cancels active work in place and waits for cleanup before advancing the queue', async () => {
    const controller = new AbortController();
    const first = stage(new Blob(['first']), 'first', controller.signal);
    const second = stage(new Blob(['second']), 'second');
    const worker = latest();
    const firstId = worker.posted[0]?.id ?? -1;

    controller.abort();
    expect(worker.posted[1]).toEqual({ id: firstId, kind: 'cancel' });
    expect(worker.posted).toHaveLength(2);
    worker.reply({ id: firstId, kind: 'cancelled' });

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const secondRequest = worker.posted[2];
    expect(secondRequest).toMatchObject({ kind: 'stage' });
    if (secondRequest?.kind !== 'stage') throw new Error('expected second stage request');
    worker.reply({ id: secondRequest.id, kind: 'error', message: 'done' });
    await expect(second).rejects.toThrow('done');
  });

  it('removes a cancelled queued request without posting it', async () => {
    const first = stage(new Blob(['first']), 'first');
    const controller = new AbortController();
    const second = stage(new Blob(['second']), 'second', controller.signal);
    const worker = latest();

    controller.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.posted).toHaveLength(1);
    worker.reply({ id: worker.posted[0]?.id ?? -1, kind: 'error', message: 'done' });
    await expect(first).rejects.toThrow('done');
  });

  it('rejects only active staging and continues queued work on a fresh worker after crash', async () => {
    const first = stage(new Blob(['first']), 'first');
    const queued = stage(new Blob(['queued']), 'queued');
    const failed = latest();

    failed.onerror?.();

    await expect(first).rejects.toThrow('paged asset worker errored');
    expect(failed.terminated).toBe(true);
    const replacement = latest();
    expect(replacement).not.toBe(failed);
    replacement.reply({
      id: replacement.posted[0]?.id ?? -1,
      kind: 'error',
      message: 'queued survived',
    });
    await expect(queued).rejects.toThrow('queued survived');
  });

  it('returns null when the production Worker API is unavailable', () => {
    vi.stubGlobal('Worker', undefined);

    expect(stage(new Blob(['fixture']), 'asset-one')).toBeNull();
  });
});
