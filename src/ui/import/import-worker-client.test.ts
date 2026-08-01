// Stub-Worker tests for the import worker client, following the shape of
// preparation-worker-client.test.ts. The real worker is never started here:
// what matters is the contract the callers depend on — null without Worker
// support, correct request routing, and every failure mode surfacing as a
// rejection rather than a hang.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParseGcodeProgramResult } from '../../io/gcode';
import {
  parseDxfOffThread,
  parseGcodeOffThread,
  parseStlOffThread,
  resetImportWorkerForTests,
} from './import-worker-client';
import type { ImportWorkerRequest, ImportWorkerResponse } from './import-worker-protocol';
import { packGcodeResult } from './packed-gcode-result';

class StubWorker {
  static instances: StubWorker[] = [];
  static beforePostFailure: (() => void) | null = null;
  onmessage: ((e: MessageEvent<ImportWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly posted: ImportWorkerRequest[] = [];
  terminated = false;

  constructor() {
    StubWorker.instances.push(this);
  }

  postMessage(request: ImportWorkerRequest): void {
    if (StubWorker.beforePostFailure !== null) {
      const beforeFailure = StubWorker.beforePostFailure;
      StubWorker.beforePostFailure = null;
      beforeFailure();
      throw new Error('post failed');
    }
    this.posted.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(response: ImportWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<ImportWorkerResponse>);
  }
}

function latest(): StubWorker {
  const worker = StubWorker.instances[StubWorker.instances.length - 1];
  if (worker === undefined) throw new Error('no worker was constructed');
  return worker;
}

const blob = (): Blob => new Blob(['0\nSECTION\n']);
const stlOptions = { targetWidthMm: 100, reliefDepthMm: 5, mmPerCell: 1 };

describe('import worker client', () => {
  beforeEach(() => {
    StubWorker.instances = [];
    StubWorker.beforePostFailure = null;
    vi.stubGlobal('Worker', StubWorker);
  });

  afterEach(() => {
    resetImportWorkerForTests();
    vi.unstubAllGlobals();
  });

  it('returns null when Worker is unavailable so callers keep the sync path', () => {
    vi.stubGlobal('Worker', undefined);

    expect(parseDxfOffThread(blob(), 'id', 'a.dxf')).toBeNull();
    expect(parseGcodeOffThread(blob())).toBeNull();
    expect(parseStlOffThread(blob(), stlOptions)).toBeNull();
  });

  it('sends the blob itself rather than pre-read text', () => {
    const source = blob();

    // This request is never answered, so afterEach's reset rejects it. Claim
    // that rejection here — an unowned one fails the whole run as an unhandled
    // rejection even though every assertion passes.
    parseDxfOffThread(source, 'obj-1', 'part.dxf')?.catch(() => undefined);

    const request = latest().posted[0];
    expect(request?.kind).toBe('dxf');
    expect(request?.blob).toBe(source);
    if (request?.kind === 'dxf') {
      expect(request.objectId).toBe('obj-1');
      expect(request.source).toBe('part.dxf');
    }
  });

  it('resolves the matching request with the parse result', async () => {
    const promise = parseGcodeOffThread(blob());
    const id = latest().posted[0]?.id ?? -1;

    latest().reply({ id, kind: 'gcode', result: { kind: 'error', reason: 'nope' } });

    await expect(promise).resolves.toEqual({ kind: 'error', reason: 'nope' });
  });

  it('unpacks a successful typed G-code response before resolving', async () => {
    const promise = parseGcodeOffThread(blob());
    const id = latest().posted[0]?.id ?? -1;
    const result: ParseGcodeProgramResult = {
      kind: 'ok',
      toolpath: {
        totalLength: 1,
        steps: [
          {
            kind: 'travel',
            from: { x: 0, y: 0 },
            to: { x: 1, y: 0 },
            length: 1,
          },
        ],
      },
      summary: { lineCount: 1, cutMm: 0, travelMm: 1, plungeMm: 0 },
      notes: [],
    };

    latest().reply({ id, kind: 'gcode', result: packGcodeResult(result) });

    await expect(promise).resolves.toEqual(result);
  });

  it('queues concurrent imports and starts the next only after completion', async () => {
    const first = parseDxfOffThread(blob(), 'a', 'a.dxf');
    const second = parseGcodeOffThread(blob());
    const firstId = latest().posted[0]?.id ?? -1;

    expect(latest().posted).toHaveLength(1);
    latest().reply({
      id: firstId,
      kind: 'dxf',
      result: { kind: 'error', reason: 'd' },
    });
    const secondId = latest().posted[1]?.id ?? -1;
    latest().reply({ id: secondId, kind: 'gcode', result: { kind: 'error', reason: 'g' } });

    await expect(first).resolves.toEqual({ kind: 'error', reason: 'd' });
    await expect(second).resolves.toEqual({ kind: 'error', reason: 'g' });
  });

  it('reports queue position and worker phases without completing early', async () => {
    const progress = vi.fn();
    const first = parseGcodeOffThread(blob());
    const second = parseGcodeOffThread(blob(), { onProgress: progress });
    const worker = latest();
    const firstId = worker.posted[0]?.id ?? -1;

    expect(progress).toHaveBeenCalledWith({ phase: 'queued', queuePosition: 1 });
    worker.reply({ id: firstId, kind: 'gcode', result: { kind: 'error', reason: 'first' } });
    const secondId = worker.posted[1]?.id ?? -1;
    worker.reply({ id: secondId, kind: 'progress', phase: 'reading' });
    expect(progress).toHaveBeenCalledWith({ phase: 'reading', queuePosition: 0 });
    worker.reply({ id: secondId, kind: 'gcode', result: { kind: 'error', reason: 'second' } });

    await expect(first).resolves.toMatchObject({ reason: 'first' });
    await expect(second).resolves.toMatchObject({ reason: 'second' });
  });

  it('cancels a queued request without posting it', async () => {
    const first = parseGcodeOffThread(blob());
    const controller = new AbortController();
    const second = parseGcodeOffThread(blob(), { signal: controller.signal });
    controller.abort();

    expect(latest().posted).toHaveLength(1);
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    const firstId = latest().posted[0]?.id ?? -1;
    latest().reply({ id: firstId, kind: 'gcode', result: { kind: 'error', reason: 'done' } });
    await expect(first).resolves.toMatchObject({ reason: 'done' });
  });

  it('terminates an active parse on cancel and continues the queue on a fresh worker', async () => {
    const controller = new AbortController();
    const first = parseGcodeOffThread(blob(), { signal: controller.signal });
    const firstWorker = latest();
    const second = parseGcodeOffThread(blob());

    controller.abort();

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(firstWorker.terminated).toBe(true);
    const secondWorker = latest();
    expect(secondWorker).not.toBe(firstWorker);
    firstWorker.onerror?.();
    expect(secondWorker.terminated).toBe(false);
    const secondId = secondWorker.posted[0]?.id ?? -1;
    secondWorker.reply({ id: secondId, kind: 'gcode', result: { kind: 'error', reason: 'next' } });
    await expect(second).resolves.toMatchObject({ reason: 'next' });
  });

  it('rejects on a worker-reported error', async () => {
    const promise = parseStlOffThread(blob(), stlOptions);
    const id = latest().posted[0]?.id ?? -1;

    latest().reply({ id, kind: 'error', message: 'boom' });

    await expect(promise).rejects.toThrow('boom');
  });

  it('rejects rather than mis-casting when the worker answers the wrong kind', async () => {
    const promise = parseStlOffThread(blob(), stlOptions);
    const id = latest().posted[0]?.id ?? -1;

    latest().reply({ id, kind: 'gcode', result: { kind: 'error', reason: 'mismatched' } });

    await expect(promise).rejects.toThrow(/answered 'gcode' for a 'stl' request/);
  });

  it('rejects every in-flight request and retires the worker when it errors', async () => {
    const promise = parseDxfOffThread(blob(), 'a', 'a.dxf');
    const worker = latest();

    worker.onerror?.();

    await expect(promise).rejects.toThrow('import worker errored');
    expect(worker.terminated).toBe(true);
  });

  it('retires a postMessage failure before advancing queued work', async () => {
    let second: Promise<ParseGcodeProgramResult> | null = null;
    StubWorker.beforePostFailure = () => {
      second = parseGcodeOffThread(blob());
      void second?.catch(() => undefined);
    };

    const first = parseGcodeOffThread(blob());
    const failedWorker = StubWorker.instances[0];
    await expect(first).rejects.toThrow('post failed');
    expect(failedWorker?.terminated).toBe(true);

    const freshWorker = latest();
    expect(freshWorker).not.toBe(failedWorker);
    const secondId = freshWorker.posted[0]?.id ?? -1;
    freshWorker.reply({
      id: secondId,
      kind: 'gcode',
      result: { kind: 'error', reason: 'next' },
    });
    await expect(second).resolves.toEqual({ kind: 'error', reason: 'next' });
  });
});
