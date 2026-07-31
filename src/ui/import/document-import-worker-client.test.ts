import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseProjectOffThread,
  parseSvgOffThread,
  resetDocumentImportWorkerForTests,
} from './document-import-worker-client';
import type {
  DocumentImportWorkerRequest,
  DocumentImportWorkerResponse,
} from './document-import-worker-protocol';

class StubWorker {
  static instances: StubWorker[] = [];
  onmessage: ((event: MessageEvent<DocumentImportWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly posted: DocumentImportWorkerRequest[] = [];
  terminated = false;

  constructor() {
    StubWorker.instances.push(this);
  }
  postMessage(request: DocumentImportWorkerRequest): void {
    this.posted.push(request);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(response: DocumentImportWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<DocumentImportWorkerResponse>);
  }
}

function latest(): StubWorker {
  const worker = StubWorker.instances.at(-1);
  if (worker === undefined) throw new Error('no worker');
  return worker;
}

describe('document import worker client', () => {
  beforeEach(() => {
    StubWorker.instances = [];
    vi.stubGlobal('Worker', StubWorker);
  });
  afterEach(() => {
    resetDocumentImportWorkerForTests();
    vi.unstubAllGlobals();
  });

  it('passes Blobs without reading them and resolves the matching result', async () => {
    const blob = new Blob(['{}']);
    const pending = parseProjectOffThread(blob);
    const request = latest().posted[0];
    expect(request).toMatchObject({ kind: 'project', blob });
    latest().reply({
      id: request?.id ?? -1,
      kind: 'project',
      result: { kind: 'invalid', reason: 'fixture' },
    });
    await expect(pending).resolves.toEqual({ kind: 'invalid', reason: 'fixture' });
  });

  it('queues formats FIFO and reports progress', async () => {
    const progress = vi.fn();
    const first = parseProjectOffThread(new Blob(['{}']));
    const second = parseSvgOffThread(new Blob(['<svg/>']), 'id', 'a.svg', {
      onProgress: progress,
    });
    expect(latest().posted).toHaveLength(1);
    expect(progress).toHaveBeenCalledWith({ phase: 'queued', queuePosition: 1 });
    const firstId = latest().posted[0]?.id ?? -1;
    latest().reply({
      id: firstId,
      kind: 'project',
      result: { kind: 'invalid', reason: 'fixture' },
    });
    const secondId = latest().posted[1]?.id ?? -1;
    latest().reply({ id: secondId, kind: 'progress', phase: 'parsing' });
    expect(progress).toHaveBeenCalledWith({ phase: 'parsing', queuePosition: 0 });
    latest().reply({
      id: secondId,
      kind: 'svg',
      result: {
        object: null,
        stripped: { scripts: 0, foreignObjects: 0, externalLinks: 0, dataUris: 0 },
        notes: [],
        ignoredTextElements: 0,
        ignoredImageElements: 0,
      },
    });
    await expect(first).resolves.toMatchObject({ kind: 'invalid' });
    await expect(second).resolves.toMatchObject({ object: null });
  });

  it('cancels active work and continues queued work on a fresh worker', async () => {
    const controller = new AbortController();
    const first = parseProjectOffThread(new Blob(['{}']), { signal: controller.signal });
    const firstWorker = latest();
    const second = parseProjectOffThread(new Blob(['{}']));
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(firstWorker.terminated).toBe(true);
    const fresh = latest();
    fresh.reply({
      id: fresh.posted[0]?.id ?? -1,
      kind: 'project',
      result: { kind: 'invalid', reason: 'second' },
    });
    await expect(second).resolves.toMatchObject({ reason: 'second' });
  });
});
