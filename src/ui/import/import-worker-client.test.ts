// Stub-Worker tests for the import worker client, following the shape of
// preparation-worker-client.test.ts. The real worker is never started here:
// what matters is the contract the callers depend on — null without Worker
// support, correct request routing, and every failure mode surfacing as a
// rejection rather than a hang.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseDxfOffThread,
  parseGcodeOffThread,
  parseStlOffThread,
  resetImportWorkerForTests,
} from './import-worker-client';
import type { ImportWorkerRequest, ImportWorkerResponse } from './import-worker-protocol';

class StubWorker {
  static instances: StubWorker[] = [];
  onmessage: ((e: MessageEvent<ImportWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly posted: ImportWorkerRequest[] = [];
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

function latest(): StubWorker {
  const worker = StubWorker.instances[StubWorker.instances.length - 1];
  if (worker === undefined) throw new Error('no worker was constructed');
  return worker;
}

const blob = (): Blob => new Blob(['0\nSECTION\n']);

describe('import worker client', () => {
  beforeEach(() => {
    StubWorker.instances = [];
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
    expect(parseStlOffThread(blob())).toBeNull();
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

  it('keeps concurrent imports independent', async () => {
    const first = parseDxfOffThread(blob(), 'a', 'a.dxf');
    const second = parseGcodeOffThread(blob());
    const [firstId, secondId] = latest().posted.map((r) => r.id);

    latest().reply({ id: secondId ?? -1, kind: 'gcode', result: { kind: 'error', reason: 'g' } });
    latest().reply({
      id: firstId ?? -1,
      kind: 'dxf',
      result: { kind: 'error', reason: 'd' },
    });

    await expect(second).resolves.toEqual({ kind: 'error', reason: 'g' });
    await expect(first).resolves.toEqual({ kind: 'error', reason: 'd' });
  });

  it('rejects on a worker-reported error', async () => {
    const promise = parseStlOffThread(blob());
    const id = latest().posted[0]?.id ?? -1;

    latest().reply({ id, kind: 'error', message: 'boom' });

    await expect(promise).rejects.toThrow('boom');
  });

  it('rejects rather than mis-casting when the worker answers the wrong kind', async () => {
    const promise = parseStlOffThread(blob());
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
});
