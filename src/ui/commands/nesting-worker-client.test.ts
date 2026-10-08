import { afterEach, describe, expect, it, vi } from 'vitest';
import { startNestingSearch } from './nesting-worker-client';
import type { NestingWorkerResponse } from './nesting-worker-protocol';
import { layoutNest, type NestingInput } from '../../core/nesting/layout-nest';

class FakeWorker {
  static last: FakeWorker;
  onmessage: ((event: MessageEvent<NestingWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.last = this;
  }
  send(data: NestingWorkerResponse): void {
    this.onmessage?.({ data } as MessageEvent<NestingWorkerResponse>);
  }
}
const input: NestingInput = {
  bin: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
  items: [{ id: 'a', width: 10, height: 10, canRotate: false }],
  padding: 2,
  goal: 'compact',
  method: 'fast',
  optimise: true,
};
afterEach(() => vi.unstubAllGlobals());

describe('owned nesting worker', () => {
  it('terminates polygon work on stop and retains only a complete earlier best', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const progress = vi.fn();
    const task = startNestingSearch(input, progress);
    const worker = FakeWorker.last;
    const best = layoutNest(input)!;
    worker.send({ kind: 'progress', progress: { attempted: 1, total: 24, best } });
    task.cancel();
    worker.send({ kind: 'progress', progress: { attempted: 2, total: 24, best: null } });
    expect(await task.result).toEqual({ cancelled: true, best });
    expect(progress).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('disposes completed and failed workers exactly once', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const completed = startNestingSearch(input, vi.fn());
    FakeWorker.last.send({ kind: 'complete' });
    completed.cancel();
    expect(await completed.result).toEqual({ cancelled: false, best: null });
    expect(FakeWorker.last.terminate).toHaveBeenCalledOnce();
    const failed = startNestingSearch(input, vi.fn());
    const rejection = expect(failed.result).rejects.toThrow('failed');
    FakeWorker.last.onerror?.();
    await rejection;
    failed.cancel();
    expect(FakeWorker.last.terminate).toHaveBeenCalledOnce();
  });
});
