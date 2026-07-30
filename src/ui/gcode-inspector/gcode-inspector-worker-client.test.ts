import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inspectGcodeOffThread,
  resetGcodeInspectorWorkerForTests,
} from './gcode-inspector-worker-client';
import type {
  GcodeInspectorWorkerRequest,
  GcodeInspectorWorkerResponse,
  GcodeInspectorWorkerResult,
} from './gcode-inspector-worker-protocol';

class StubWorker {
  static instances: StubWorker[] = [];
  static beforePostFailure: (() => void) | null = null;
  onmessage: ((event: MessageEvent<GcodeInspectorWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly posted: GcodeInspectorWorkerRequest[] = [];
  isTerminated = false;

  constructor() {
    StubWorker.instances.push(this);
  }

  postMessage(request: GcodeInspectorWorkerRequest): void {
    if (StubWorker.beforePostFailure !== null) {
      const beforeFailure = StubWorker.beforePostFailure;
      StubWorker.beforePostFailure = null;
      beforeFailure();
      throw new Error('post failed');
    }
    this.posted.push(request);
  }

  terminate(): void {
    this.isTerminated = true;
  }

  reply(response: GcodeInspectorWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<GcodeInspectorWorkerResponse>);
  }
}

const result = {
  parsed: { kind: 'error' as const, reason: 'fixture' },
  lines: [],
  sourceLineCount: 0,
};

function latest(): StubWorker {
  const worker = StubWorker.instances[StubWorker.instances.length - 1];
  if (worker === undefined) throw new Error('no worker');
  return worker;
}

describe('G-code Inspector worker client', () => {
  beforeEach(() => {
    StubWorker.instances = [];
    StubWorker.beforePostFailure = null;
    vi.stubGlobal('Worker', StubWorker);
  });

  afterEach(() => {
    resetGcodeInspectorWorkerForTests();
    vi.unstubAllGlobals();
  });

  it('returns null only when workers are unavailable', () => {
    vi.stubGlobal('Worker', undefined);
    expect(inspectGcodeOffThread({ kind: 'text', text: 'G0 X1' })).toBeNull();
  });

  it('passes a Blob without reading it on the caller thread', async () => {
    const blob = new Blob(['G0 X1']);
    const promise = inspectGcodeOffThread({ kind: 'blob', blob });
    const worker = StubWorker.instances[0];
    const request = worker?.posted[0];
    expect(request?.source).toEqual({ kind: 'blob', blob });
    worker?.reply({
      id: request?.id ?? -1,
      kind: 'complete',
      result,
    });
    await expect(promise).resolves.toMatchObject({ sourceLineCount: 0 });
  });

  it('queues requests and reports worker phases', async () => {
    const progress = vi.fn();
    const first = inspectGcodeOffThread({ kind: 'text', text: 'G0 X1' });
    const second = inspectGcodeOffThread({ kind: 'text', text: 'G0 X2' }, { onProgress: progress });
    const worker = latest();
    expect(worker.posted).toHaveLength(1);
    expect(progress).toHaveBeenCalledWith({ phase: 'queued', queuePosition: 1 });

    worker.reply({ id: worker.posted[0]?.id ?? -1, kind: 'complete', result });
    const secondId = worker.posted[1]?.id ?? -1;
    worker.reply({ id: secondId, kind: 'progress', phase: 'parsing' });
    expect(progress).toHaveBeenCalledWith({ phase: 'parsing', queuePosition: 0 });
    worker.reply({ id: secondId, kind: 'complete', result });

    await expect(first).resolves.toEqual(result);
    await expect(second).resolves.toEqual(result);
  });

  it('cancels queued work without posting it', async () => {
    const first = inspectGcodeOffThread({ kind: 'text', text: 'G0 X1' });
    const controller = new AbortController();
    const second = inspectGcodeOffThread(
      { kind: 'text', text: 'G0 X2' },
      { signal: controller.signal },
    );
    controller.abort();

    expect(latest().posted).toHaveLength(1);
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    latest().reply({ id: latest().posted[0]?.id ?? -1, kind: 'complete', result });
    await expect(first).resolves.toEqual(result);
  });

  it('terminates active work and continues queued work on a fresh worker', async () => {
    const controller = new AbortController();
    const first = inspectGcodeOffThread(
      { kind: 'text', text: 'G0 X1' },
      { signal: controller.signal },
    );
    const firstWorker = latest();
    const second = inspectGcodeOffThread({ kind: 'text', text: 'G0 X2' });
    controller.abort();

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(firstWorker.isTerminated).toBe(true);
    const secondWorker = latest();
    expect(secondWorker).not.toBe(firstWorker);
    firstWorker.onerror?.();
    expect(secondWorker.isTerminated).toBe(false);
    secondWorker.reply({ id: secondWorker.posted[0]?.id ?? -1, kind: 'complete', result });
    await expect(second).resolves.toEqual(result);
  });

  it('retires a postMessage failure before advancing queued work', async () => {
    let second: Promise<GcodeInspectorWorkerResult> | null = null;
    StubWorker.beforePostFailure = () => {
      second = inspectGcodeOffThread({ kind: 'text', text: 'G0 X2' });
      void second?.catch(() => undefined);
    };

    const first = inspectGcodeOffThread({ kind: 'text', text: 'G0 X1' });
    const failedWorker = StubWorker.instances[0];
    await expect(first).rejects.toThrow('post failed');
    expect(failedWorker?.isTerminated).toBe(true);

    const freshWorker = latest();
    expect(freshWorker).not.toBe(failedWorker);
    freshWorker.reply({ id: freshWorker.posted[0]?.id ?? -1, kind: 'complete', result });
    await expect(second).resolves.toEqual(result);
  });
});
