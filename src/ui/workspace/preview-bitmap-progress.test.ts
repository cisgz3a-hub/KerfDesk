import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Toolpath, ToolpathStep } from '../../core/job';
import { PreviewBitmapRenderer } from './preview-bitmap-renderer';
import type { PreviewRouteWorkerRequest } from './preview-route-worker-protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn<(_request: PreviewRouteWorkerRequest) => void>();
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  reply(request: PreviewRouteWorkerRequest) {
    this.onmessage?.({
      data: {
        kind: 'painted',
        id: request.id,
        frameId: request.frameId,
        bitmap: { close: vi.fn() },
      },
    } as MessageEvent);
  }
}
const view = { scale: 1, offsetX: 10, offsetY: 20 };
const step: ToolpathStep = { kind: 'travel', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, length: 1 };
const route: Toolpath = { steps: Array.from({ length: 20_000 }, () => step), totalLength: 20_000 };
let current: PreviewBitmapRenderer | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('OffscreenCanvas', vi.fn());
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ close: vi.fn() })),
  );
});
afterEach(() => {
  current?.clear(false);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture() {
  const changed = vi.fn();
  const renderer = new PreviewBitmapRenderer(changed);
  current = renderer;
  const ctx = {
    canvas: { width: 800, height: 600 },
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const draw = async (
    nextView = view,
    nextRoute = route,
    t = 1,
    travel = true,
    backgroundKey = nextRoute as object,
  ) => {
    renderer.draw(ctx, nextRoute, nextView, t, travel, backgroundKey);
    await Promise.resolve();
    await Promise.resolve();
  };
  return { renderer, changed, draw };
}
function request(worker: FakeWorker, index = 0): PreviewRouteWorkerRequest {
  return worker.postMessage.mock.calls[index]![0];
}
describe('Preview progress presentation', () => {
  it('resets the quiet-progress deadline and never calls an interim image settled', async () => {
    const f = fixture();
    await f.draw();
    const worker = FakeWorker.instances[0]!;
    worker.reply(request(worker));
    await f.draw(view, route, 0.1);
    worker.reply(request(worker, 1));
    await f.draw(view, route, 0.1);
    expect(f.changed).toHaveBeenLastCalledWith(true, false);
    await vi.advanceTimersByTimeAsync(100);
    await f.draw(view, route, 0.2);
    worker.reply(request(worker, 2));
    await vi.advanceTimersByTimeAsync(100);
    await f.draw(view, route, 0.2);
    expect(worker.postMessage).toHaveBeenCalledTimes(3);
    expect(f.changed).toHaveBeenLastCalledWith(true, false);
    await vi.advanceTimersByTimeAsync(50);
    await f.draw(view, route, 0.2);
    expect(request(worker, 3).interactive).toBe(false);
    worker.reply(request(worker, 3));
    await f.draw(view, route, 0.2);
    expect(f.changed).toHaveBeenLastCalledWith(false, false);
  });

  it.each(['clear', 'error', 'background'] as const)(
    'cancels quiet-progress work after %s',
    async (action) => {
      const f = fixture();
      await f.draw();
      const worker = FakeWorker.instances[0]!;
      worker.reply(request(worker));
      await f.draw(view, route, 0.5);
      if (action === 'clear') f.renderer.clear();
      else if (action === 'error') worker.onerror?.();
      else await f.draw(view, route, 0.5, true, {});
      const changes = f.changed.mock.calls.length;
      await vi.advanceTimersByTimeAsync(200);
      expect(f.changed).toHaveBeenCalledTimes(changes);
    },
  );
});
