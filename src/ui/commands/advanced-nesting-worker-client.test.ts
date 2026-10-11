import { afterEach, describe, expect, it, vi } from 'vitest';
import { productionFixture } from '../../core/nesting/production-nest.test-fixture';
import { planProductionNest } from '../../core/nesting/production-nest-plan';
import { startProductionNestingSearch } from './production-nesting-worker-client';

class FakeWorker {
  static last: FakeWorker;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.last = this;
  }
  send(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function launch(isolated = true) {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('crossOriginIsolated', isolated);
  const input = productionFixture();
  const progress = vi.fn();
  const search = startProductionNestingSearch(input, progress, true);
  const module = FakeWorker.last;
  const best = planProductionNest(input);
  module.send({
    kind: 'production-progress',
    progress: { attempted: 1, total: 1, best, advanced: true },
  });
  return { input, progress, search, module, best };
}
describe('advanced worker ownership', () => {
  it('terminates both workers on cancellation and ignores late solver events', async () => {
    const { module, best, search } = launch();
    module.send({ kind: 'advanced-start', instance: '{}' });
    const engine = FakeWorker.last;
    expect(engine).not.toBe(module);
    engine.send({ kind: 'certificate', certificate: '{"bins":[]}' });
    expect(module.postMessage).toHaveBeenLastCalledWith({
      kind: 'advanced-result',
      certificate: '{"bins":[]}',
    });
    search.cancel();
    expect(await search.result).toEqual({ cancelled: true, best });
    expect(module.terminate).toHaveBeenCalledOnce();
    expect(engine.terminate).toHaveBeenCalledOnce();
    const count = module.postMessage.mock.calls.length;
    engine.send({ kind: 'certificate', certificate: 'late' });
    expect(module.postMessage).toHaveBeenCalledTimes(count);
  });
  it('retains the valid baseline and stops both workers at the hard deadline', async () => {
    vi.useFakeTimers();
    const { module, best, search, progress } = launch();
    module.send({ kind: 'advanced-start', instance: '{}' });
    const engine = FakeWorker.last;
    await vi.advanceTimersByTimeAsync(15000);
    expect(await search.result).toEqual({ cancelled: false, best });
    expect(module.terminate).toHaveBeenCalledOnce();
    expect(engine.terminate).toHaveBeenCalledOnce();
    expect(progress.mock.lastCall?.[0].notice).toContain('time limit');
  });
  it('uses standard nesting and explains unavailable browser isolation', async () => {
    const { module, best, search, progress, input } = launch(false);
    expect(module.postMessage).toHaveBeenCalledWith({ kind: 'production-search', input });
    expect(progress.mock.lastCall?.[0].notice).toContain('unavailable in this browser context');
    module.send({ kind: 'production-complete' });
    expect(await search.result).toEqual({ cancelled: false, best });
  });
  it('retains the latest validated draft after an advanced engine failure', async () => {
    const { module, best, search } = launch();
    module.send({ kind: 'advanced-start', instance: '{}' });
    const engine = FakeWorker.last;
    engine.send({ kind: 'error', message: 'engine failed' });
    expect(engine.terminate).toHaveBeenCalledOnce();
    expect(module.postMessage.mock.lastCall?.[0]).toMatchObject({
      kind: 'advanced-finished',
      notice: expect.stringContaining('retained'),
    });
    module.send({ kind: 'production-complete' });
    expect(await search.result).toEqual({ cancelled: false, best });
  });
});
