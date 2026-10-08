import { afterEach, describe, expect, it, vi } from 'vitest';
import { productionFixture } from '../../core/nesting/production-nest.test-fixture';
import { planProductionNest } from '../../core/nesting/production-nest-plan';
import { startProductionNestingSearch } from './production-nesting-worker-client';
import type { NestingWorkerResponse } from './nesting-worker-protocol';

class FakeProductionWorker {
  static last: FakeProductionWorker;
  onmessage: ((event: MessageEvent<NestingWorkerResponse>) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeProductionWorker.last = this;
  }
  send(data: NestingWorkerResponse): void {
    this.onmessage?.({ data } as MessageEvent<NestingWorkerResponse>);
  }
}
afterEach(() => vi.unstubAllGlobals());
describe('production worker ownership', () => {
  it('terminates on cancel while retaining the reviewed best and ignores late events', async () => {
    vi.stubGlobal('Worker', FakeProductionWorker);
    const input = productionFixture();
    const progress = vi.fn();
    const search = startProductionNestingSearch(input, progress);
    const worker = FakeProductionWorker.last;
    const best = planProductionNest(input);
    worker.send({ kind: 'production-progress', progress: { attempted: 1, total: 24, best } });
    search.cancel();
    search.cancel();
    worker.send({ kind: 'production-progress', progress: { attempted: 2, total: 24, best: null } });
    expect(await search.result).toEqual({ cancelled: true, best });
    expect(progress).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.postMessage).toHaveBeenCalledWith({ kind: 'production-search', input });
  });
  it('rejects worker failures and ignores selection-nesting events', async () => {
    vi.stubGlobal('Worker', FakeProductionWorker);
    const progress = vi.fn();
    const search = startProductionNestingSearch(productionFixture(), progress);
    const worker = FakeProductionWorker.last;
    worker.send({ kind: 'progress', progress: { attempted: 1, total: 1, best: null } });
    expect(progress).not.toHaveBeenCalled();
    const rejected = expect(search.result).rejects.toThrow('broken');
    worker.send({ kind: 'error', message: 'broken' });
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
