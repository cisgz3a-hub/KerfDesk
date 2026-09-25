import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHpgl } from '../../io/hpgl';
import type { BlobSourceFile } from '../import/import-file-blob';
import { parseHpglOffThread, resetImportWorkerForTests } from '../import/import-worker-client';
import type { ImportWorkerRequest, ImportWorkerResponse } from '../import/import-worker-protocol';
import { importWorkerTransferables } from '../import/import-worker-transferables';
import { packHpglResult, unpackHpglResult } from '../import/packed-hpgl-result';
import { importHpglFile } from './hpgl-import-action';
import { bindImportActionsToDocument, captureImportDocumentOwner } from './import-dispatch';

const ARTWORK = 'IN;SP1;PU0,0;PD400,0,400,200;PU;SP2;RA800,400;';

class StubWorker {
  static instances: StubWorker[] = [];
  onmessage: ((event: MessageEvent<ImportWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: ImportWorkerRequest[] = [];
  terminated = false;
  constructor() {
    StubWorker.instances.push(this);
  }
  postMessage(request: ImportWorkerRequest): void {
    this.posted.push(request);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(response: ImportWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<ImportWorkerResponse>);
  }
}

function worker(): StubWorker {
  const current = StubWorker.instances.at(-1);
  if (current === undefined) throw new Error('No worker');
  return current;
}

function context() {
  return {
    importObject: vi.fn(() => ({ kind: 'added' as const })),
    pushToast: vi.fn(),
    nextSuccessIndex: vi.fn(() => 7),
  };
}

function file(name = 'part.plt', content = ARTWORK) {
  const blob = new Blob([content]);
  const text = vi.fn(async () => content);
  return { name, size: blob.size, blob: async () => blob, text };
}

async function settleQueue(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function parsedResponse(target: StubWorker, text = ARTWORK): ImportWorkerResponse {
  const request = target.posted.at(-1);
  if (request?.kind !== 'hpgl') throw new Error('Expected HPGL request');
  return {
    id: request.id,
    kind: 'hpgl',
    result: packHpglResult(parseHpgl({ text, id: request.objectId, source: request.source })),
  };
}

beforeEach(() => {
  StubWorker.instances = [];
  vi.stubGlobal('Worker', StubWorker);
});

afterEach(() => {
  resetImportWorkerForTests();
  vi.unstubAllGlobals();
});

describe('HPGL import worker and file action', () => {
  it('sends the Blob and transfers exact geometry, fill rules, pen order and diagnostics', async () => {
    const input = file();
    const ctx = context();
    const pending = importHpglFile(input, ctx);
    await settleQueue();
    const target = worker();
    expect(target.posted[0]).toMatchObject({
      kind: 'hpgl',
      blob: await input.blob(),
      source: 'part.plt',
    });
    expect(input.text).not.toHaveBeenCalled();
    const response = parsedResponse(target);
    const transfer = [...importWorkerTransferables(response)];
    expect(transfer).toHaveLength(11);
    const transferred = structuredClone(response, { transfer });
    expect(transfer.every((buffer) => buffer.byteLength === 0)).toBe(true);
    target.reply(transferred);
    await pending;
    expect(ctx.nextSuccessIndex).toHaveBeenCalledOnce();
    expect(ctx.importObject).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'part.plt',
        bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
        paths: [
          expect.objectContaining({ color: '#000000' }),
          expect.objectContaining({ color: '#ff0000', fillRule: 'evenodd' }),
        ],
      }),
      7,
    );
    expect(ctx.pushToast).toHaveBeenCalledWith(expect.stringMatching(/Fill/), 'warning');
    expect(ctx.pushToast).toHaveBeenCalledWith('Imported 2 paths from part.plt.', 'success');
  });

  it('reports a scale-to-fit after its diagnostics and success notice', async () => {
    const ctx = context();
    const outcome = {
      kind: 'added' as const,
      bedFit: { scale: 0.36, widthMm: 1000, heightMm: 500, bedWidthMm: 400, bedHeightMm: 400 },
    };
    ctx.importObject.mockReturnValue(outcome);
    const pending = importHpglFile(file(), ctx);
    await settleQueue();
    worker().reply(parsedResponse(worker()));
    await pending;

    expect(ctx.pushToast.mock.calls.slice(-2)).toEqual([
      ['Imported 2 paths from part.plt.', 'success'],
      [
        'part.plt is larger than the 400 × 400 mm bed (1000 × 500 mm), so it was scaled to 36% ' +
          'to fit. Undo restores the original size.',
        'warning',
      ],
    ]);
  });

  it('exposes command diagnostics and does not claim an index for unsupported partial artwork', async () => {
    const ctx = context();
    const pending = importHpglFile(file('unsupported.hpgl'), ctx);
    await settleQueue();
    const response = parsedResponse(worker(), 'SP1;PD40,40;LBmissing text;');
    expect(importWorkerTransferables(response)).toEqual([]);
    worker().reply(response);
    await pending;
    expect(ctx.importObject).not.toHaveBeenCalled();
    expect(ctx.nextSuccessIndex).not.toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith(
      expect.stringMatching(/unsupported\.hpgl: HPGL at character 13 \(LB\).*Unsupported command/i),
      'error',
    );
  });

  it('does not claim an index for empty pen-zero artwork', async () => {
    const ctx = context();
    const pending = importHpglFile(file(), ctx);
    await settleQueue();
    worker().reply(parsedResponse(worker(), 'IN;PD40,40;'));
    await pending;
    expect(ctx.importObject).not.toHaveBeenCalled();
    expect(ctx.nextSuccessIndex).not.toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith(
      'part.plt: no drawable HPGL geometry found.',
      'warning',
    );
  });

  it('cancels through Escape without main-thread retry or a claimed index', async () => {
    const input = file();
    const ctx = context();
    const pending = importHpglFile(input, ctx);
    await settleQueue();
    const retired = worker();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await pending;
    retired.reply(parsedResponse(retired));
    expect(retired.terminated).toBe(true);
    expect(input.text).not.toHaveBeenCalled();
    expect(ctx.importObject).not.toHaveBeenCalled();
    expect(ctx.nextSuccessIndex).not.toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith('part.plt: import cancelled.', 'warning');
  });

  it('keeps HPGL queued and removes a cancelled request before posting it', async () => {
    const first = parseHpglOffThread(new Blob(), 'one', 'one.plt');
    const controller = new AbortController();
    const progress = vi.fn();
    const second = parseHpglOffThread(new Blob(), 'two', 'two.plt', {
      signal: controller.signal,
      onProgress: progress,
    });
    expect(progress).toHaveBeenCalledWith({ phase: 'queued', queuePosition: 1 });
    controller.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker().posted).toHaveLength(1);
    worker().reply(parsedResponse(worker(), 'IN;'));
    await expect(first).resolves.toMatchObject({ kind: 'ok', object: null });
  });

  it('does not retry a started worker failure on the main thread', async () => {
    const ctx = context();
    const input = file();
    const pending = importHpglFile(input, ctx);
    await settleQueue();
    worker().onerror?.();
    await pending;
    expect(input.text).not.toHaveBeenCalled();
    expect(ctx.nextSuccessIndex).not.toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith('part.plt: import worker errored', 'error');
  });

  it('discloses the fallback only when the worker cannot be constructed', async () => {
    vi.stubGlobal('Worker', undefined);
    const ctx = context();
    const input = file();
    await importHpglFile(input, ctx);
    expect(input.text).toHaveBeenCalledOnce();
    expect(ctx.importObject).toHaveBeenCalledOnce();
    expect(ctx.pushToast).toHaveBeenCalledWith(expect.stringMatching(/main thread/), 'warning');
  });

  it('honours cancellation while a text-only adapter is still reading', async () => {
    let finish!: (text: string) => void;
    const input: BlobSourceFile = {
      name: 'adapter.plt',
      text: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    };
    const ctx = context();
    const pending = importHpglFile(input, ctx);
    await settleQueue();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    finish(ARTWORK);
    await pending;
    expect(ctx.importObject).not.toHaveBeenCalled();
    expect(ctx.nextSuccessIndex).not.toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith('adapter.plt: import cancelled.', 'warning');
  });

  it('leaves document ownership to the bound callbacks and suppresses stale completion', async () => {
    let epoch = 1;
    const ctx = context();
    const actions = {
      getProjectDocumentEpoch: () => epoch,
      importSvgObject: ctx.importObject,
      importRasterImage: vi.fn(),
      pushToast: ctx.pushToast,
    };
    const owned = bindImportActionsToDocument(
      actions,
      captureImportDocumentOwner(() => epoch),
    );
    const pending = importHpglFile(file(), {
      importObject: owned.importSvgObject,
      pushToast: owned.pushToast,
    });
    await settleQueue();
    ctx.pushToast.mockClear();
    epoch = 2;
    worker().reply(parsedResponse(worker()));
    await pending;
    expect(ctx.importObject).not.toHaveBeenCalled();
    expect(ctx.pushToast).not.toHaveBeenCalled();
  });

  it('uses the existing layer-preserving replacement toast', async () => {
    const pushToast = vi.fn();
    const pending = importHpglFile(file(), {
      importObject: () => ({ kind: 'replaced', source: 'part.plt', kept: 2, added: 0, removed: 0 }),
      pushToast,
    });
    await settleQueue();
    worker().reply(parsedResponse(worker()));
    await pending;
    expect(pushToast).toHaveBeenLastCalledWith(
      'Re-imported part.plt — layer settings preserved (2 kept)',
      'success',
    );
  });

  it('executes the real worker handler with honest phases and packed HPGL diagnostics', async () => {
    const messages: ImportWorkerResponse[] = [];
    const transfers: ArrayBuffer[][] = [];
    let complete!: () => void;
    const completed = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const scope = {
      onmessage: null as ((event: MessageEvent<ImportWorkerRequest>) => void) | null,
      postMessage: (response: ImportWorkerResponse, options?: { transfer: ArrayBuffer[] }) => {
        messages.push(response);
        if (options !== undefined) transfers.push(options.transfer);
        if (response.kind !== 'progress') complete();
      },
    };
    vi.stubGlobal('self', scope);
    await import('../import/import-worker');
    const read = vi.fn(async () => ARTWORK);
    const blob = { text: read, size: ARTWORK.length } as unknown as Blob;
    scope.onmessage?.({
      data: { id: 900, kind: 'hpgl', blob, objectId: 'worker-object', source: 'worker.plt' },
    } as MessageEvent<ImportWorkerRequest>);
    await completed;
    expect(read).toHaveBeenCalledOnce();
    expect(messages.slice(0, 2)).toEqual([
      { id: 900, kind: 'progress', phase: 'reading' },
      {
        id: 900,
        kind: 'progress',
        phase: 'parsing',
        bytesRead: ARTWORK.length,
        totalBytes: ARTWORK.length,
      },
    ]);
    const response = messages.at(-1);
    if (response?.kind !== 'hpgl') throw new Error('Missing HPGL worker response');
    expect(unpackHpglResult(response.result)).toEqual(
      parseHpgl({ text: ARTWORK, id: 'worker-object', source: 'worker.plt' }),
    );
    expect(transfers[0]).toHaveLength(11);
  });
});
