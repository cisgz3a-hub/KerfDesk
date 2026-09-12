import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Toolpath, ToolpathStep } from '../../core/job';
import { PreviewBitmapRenderer } from './preview-bitmap-renderer';
import { preparePreviewFrame } from './preview-route-frame';
import { unpackPreviewFrame, type PackedPreviewFrame } from './preview-route-frame-transfer';
import type { ViewTransform } from './view-transform';

vi.mock('./preview-route-frame', () => ({
  preparePreviewFrame: vi.fn(() => ({
    futureSteps: [],
    wholeSteps: [],
    partial: null,
    head: null,
    start: null,
    end: null,
  })),
}));
type Request = {
  id: number;
  frameId: number;
  frame?: PackedPreviewFrame;
  view: ViewTransform;
  interactive: boolean;
};
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn<(_request: Request, _transfers: Transferable[]) => void>();
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  reply(request: Request, bitmap = image()) {
    this.onmessage?.({
      data: { kind: 'painted', id: request.id, frameId: request.frameId, bitmap },
    } as MessageEvent);
    return bitmap;
  }
}
const view = { scale: 1, offsetX: 10, offsetY: 20 };
const step: ToolpathStep = { kind: 'travel', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, length: 1 };
const route: Toolpath = { steps: Array.from({ length: 20_000 }, () => step), totalLength: 20_000 };
let renderers: PreviewBitmapRenderer[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('OffscreenCanvas', vi.fn());
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => image()),
  );
  FakeWorker.instances = [];
  vi.mocked(preparePreviewFrame).mockClear();
});
afterEach(() => {
  renderers.forEach((renderer) => renderer.clear(false));
  renderers = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function image() {
  return { close: vi.fn() } as unknown as ImageBitmap;
}
function fixture() {
  const changed = vi.fn();
  const renderer = new PreviewBitmapRenderer(changed);
  renderers.push(renderer);
  const drawImage = vi.fn();
  const ctx = {
    canvas: { width: 800, height: 600 },
    drawImage,
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
    const handled = renderer.draw(ctx, nextRoute, nextView, t, travel, backgroundKey);
    await Promise.resolve();
    await Promise.resolve();
    return handled;
  };
  return { renderer, changed, ctx, drawImage, draw };
}
function request(worker: FakeWorker, index = 0): Request {
  return worker.postMessage.mock.calls[index]![0];
}

describe('Preview bitmap ownership and viewport scheduling', () => {
  it('reuses a settled frame and sends only the view when geometry is unchanged', async () => {
    const f = fixture();
    expect(await f.draw()).toBe(true);
    const worker = FakeWorker.instances[0]!;
    for (let i = 0; i < 12; i++) await f.draw();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(preparePreviewFrame).toHaveBeenCalledTimes(1);
    const bitmap = worker.reply(request(worker));
    await f.draw();
    expect(f.drawImage).toHaveBeenLastCalledWith(bitmap, 0, 0, 800, 600);
    expect(f.changed).toHaveBeenLastCalledWith(false, false);
    await f.draw({ ...view, offsetX: 50 });
    await vi.advanceTimersByTimeAsync(150);
    await f.draw({ ...view, offsetX: 50 });
    expect(request(worker, 1).frame).toBeUndefined();
    expect(preparePreviewFrame).toHaveBeenCalledTimes(1);
  });

  it('transfers newly packed display buffers with the underlay and preserves the prepared frame', async () => {
    const f = fixture();
    await f.draw();
    const worker = FakeWorker.instances[0]!;
    const packed = request(worker).frame!;
    expect(worker.postMessage.mock.calls[0]![1]).toEqual([
      expect.objectContaining({ close: expect.any(Function) }),
      packed.coordinates.buffer,
      packed.commands.buffer,
    ]);
    expect(unpackPreviewFrame(packed)).toEqual(
      vi.mocked(preparePreviewFrame).mock.results[0]!.value,
    );
  });

  it('moves the completed image during a gesture and paints only the final settled viewport', async () => {
    const f = fixture();
    await f.draw();
    const worker = FakeWorker.instances[0]!;
    const bitmap = worker.reply(request(worker));
    let nextView = view;
    for (let offset = 20; offset <= 200; offset += 20) {
      nextView = { ...view, offsetX: offset };
      await f.draw(nextView);
      await vi.advanceTimersByTimeAsync(80);
      expect(worker.postMessage).toHaveBeenCalledTimes(1);
    }
    expect(f.drawImage).toHaveBeenLastCalledWith(bitmap, 190, 0, 800, 600);
    expect(f.changed).toHaveBeenLastCalledWith(true, false);
    await vi.advanceTimersByTimeAsync(70);
    expect(f.changed).toHaveBeenLastCalledWith(true, true);
    await f.draw(nextView);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    expect(request(worker, 1).view).toEqual(nextView);
    const final = worker.reply(request(worker, 1));
    await f.draw(nextView);
    expect(f.drawImage).toHaveBeenLastCalledWith(final, 0, 0, 800, 600);
    expect(f.changed).toHaveBeenLastCalledWith(false, false);
  });

  it.each(['clear', 'error', 'return', 'background'] as const)(
    'cancels a waiting viewport repaint after %s',
    async (action) => {
      const f = fixture();
      await f.draw();
      const worker = FakeWorker.instances[0]!;
      worker.reply(request(worker));
      const moved = { ...view, offsetX: 60 };
      await f.draw(moved);
      if (action === 'clear') f.renderer.clear();
      else if (action === 'error') worker.onerror?.();
      else if (action === 'return') await f.draw();
      else await f.draw(moved, route, 1, true, {});
      const changes = f.changed.mock.calls.length;
      await vi.advanceTimersByTimeAsync(200);
      expect(f.changed).toHaveBeenCalledTimes(changes);
      expect(worker.postMessage).toHaveBeenCalledTimes(action === 'background' ? 2 : 1);
    },
  );

  it('starts changed playback progress immediately while a viewport repaint is waiting', async () => {
    const f = fixture();
    await f.draw();
    const worker = FakeWorker.instances[0]!;
    worker.reply(request(worker));
    const moved = { ...view, offsetX: 60 };
    await f.draw(moved);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    await f.draw(moved, route, 0.5);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    expect(preparePreviewFrame).toHaveBeenLastCalledWith(route, 0.5, expect.any(Object));
    const changes = f.changed.mock.calls.length;
    await vi.advanceTimersByTimeAsync(200);
    expect(f.changed).toHaveBeenCalledTimes(changes + 1);
    expect(f.changed).toHaveBeenLastCalledWith(true, true);
    expect(request(worker, 1).interactive).toBe(true);
  });

  it('coalesces viewport changes and replaces the temporary transformed bitmap with the exact view', async () => {
    const f = fixture();
    await f.draw();
    const worker = FakeWorker.instances[0]!;
    const middle = { ...view, offsetX: 30 };
    const latest = { scale: 2, offsetX: 50, offsetY: 70 };
    await f.draw(middle);
    await f.draw(latest);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const first = worker.reply(request(worker));
    await f.draw(latest);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    expect(request(worker, 1).view).toEqual(latest);
    await f.draw(latest);
    expect(f.drawImage).toHaveBeenLastCalledWith(first, 30, 30, 1600, 1200);
    const final = worker.reply(request(worker, 1));
    expect(first.close).toHaveBeenCalledTimes(1);
    await f.draw(latest);
    expect(f.drawImage).toHaveBeenLastCalledWith(final, 0, 0, 800, 600);
    expect(f.changed).toHaveBeenLastCalledWith(false, false);
  });

  it('retains interim progress but never reuses a changed route or travel option', async () => {
    const f = fixture();
    await f.draw();
    const worker = FakeWorker.instances[0]!;
    const initial = worker.reply(request(worker));
    await f.draw(view, route, 0.25);
    expect(initial.close).not.toHaveBeenCalled();
    expect(f.changed).toHaveBeenLastCalledWith(true, false);
    const drawCalls = f.drawImage.mock.calls.length;
    await f.draw(view, route, 0.5, false);
    expect(initial.close).toHaveBeenCalledTimes(1);
    const obsolete = worker.reply(request(worker, 1));
    expect(obsolete.close).toHaveBeenCalledTimes(1);
    expect(f.drawImage).toHaveBeenCalledTimes(drawCalls);
    await f.draw(view, route, 0.5, false);
    expect(preparePreviewFrame).toHaveBeenLastCalledWith(route, 0.5, {
      showTravel: false,
      showFuture: true,
      showEndpoints: true,
    });
    worker.reply(request(worker, 2));
    const next = { ...route, totalLength: 20_001 };
    await f.draw(view, next, 0.5, false);
    expect(preparePreviewFrame).toHaveBeenLastCalledWith(next, 0.5, expect.any(Object));
  });

  it('keeps playback visible when progress advances before every render reply', async () => {
    const f = fixture();
    await f.draw(view, route, 0.1);
    const worker = FakeWorker.instances[0]!;
    await f.draw(view, route, 0.2);
    await f.draw(view, route, 0.3);
    const first = worker.reply(request(worker));
    expect(first.close).not.toHaveBeenCalled();
    expect(f.changed).toHaveBeenLastCalledWith(true, true);
    await f.draw(view, route, 0.3);
    expect(f.drawImage).toHaveBeenLastCalledWith(first, 0, 0, 800, 600);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    await f.draw(view, route, 0.4);
    await f.draw(view, route, 0.5);
    const second = worker.reply(request(worker, 1));
    expect(first.close).toHaveBeenCalledTimes(1);
    await f.draw(view, route, 0.5);
    expect(f.drawImage).toHaveBeenLastCalledWith(second, 0, 0, 800, 600);
    expect(f.changed).toHaveBeenLastCalledWith(true, false);
    expect(worker.postMessage).toHaveBeenCalledTimes(3);
    const final = worker.reply(request(worker, 2));
    await f.draw(view, route, 0.5);
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(f.drawImage).toHaveBeenLastCalledWith(final, 0, 0, 800, 600);
    expect(f.changed).toHaveBeenLastCalledWith(true, false);
    expect(worker.postMessage).toHaveBeenCalledTimes(3);
    expect(request(worker, 2).interactive).toBe(true);
    await vi.advanceTimersByTimeAsync(150);
    await f.draw(view, route, 0.5);
    expect(request(worker, 3).interactive).toBe(false);
    expect(request(worker, 3).frame).toBeUndefined();
    const settled = worker.reply(request(worker, 3));
    await f.draw(view, route, 0.5);
    expect(f.drawImage).toHaveBeenLastCalledWith(settled, 0, 0, 800, 600);
    expect(f.changed).toHaveBeenLastCalledWith(false, false);
    expect(worker.postMessage).toHaveBeenCalledTimes(4);
  });

  it('keeps an already-correct bitmap when the user returns to it before an older view finishes', async () => {
    const f = fixture();
    await f.draw();
    const worker = FakeWorker.instances[0]!;
    const correct = worker.reply(request(worker));
    await f.draw({ ...view, offsetX: 70 });
    await vi.advanceTimersByTimeAsync(150);
    await f.draw({ ...view, offsetX: 70 });
    await f.draw();
    const obsolete = worker.reply(request(worker, 1));
    expect(obsolete.close).toHaveBeenCalledTimes(1);
    expect(correct.close).not.toHaveBeenCalled();
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    expect(f.changed).toHaveBeenLastCalledWith(false, true);
  });

  it('retires old workers and closes late bitmaps without disturbing a replacement', async () => {
    const f = fixture();
    await f.draw();
    const old = FakeWorker.instances[0]!;
    const lateMessage = old.onmessage!;
    const lateError = old.onerror!;
    f.renderer.clear();
    expect(old.terminate).toHaveBeenCalledTimes(1);
    await f.draw();
    const current = FakeWorker.instances[1]!;
    const late = image();
    lateMessage({ data: { ...request(old), kind: 'painted', bitmap: late } } as MessageEvent);
    lateError();
    expect(late.close).toHaveBeenCalledTimes(1);
    expect(current.terminate).not.toHaveBeenCalled();
    current.reply(request(current));
    expect(f.changed).toHaveBeenLastCalledWith(false, true);
  });

  it.each(['error', 'messageerror', 'post'] as const)(
    'falls back after a %s failure and releases paint resources',
    async (failure) => {
      const f = fixture();
      await f.draw();
      const worker = FakeWorker.instances[0]!;
      const bitmap = worker.reply(request(worker));
      if (failure === 'post') {
        worker.postMessage.mockImplementationOnce(() => {
          throw new Error('clone failed');
        });
        expect(await f.draw(view, route, 0.5)).toBe(true);
      } else if (failure === 'error') worker.onerror?.();
      else worker.onmessageerror?.();
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(bitmap.close).toHaveBeenCalledTimes(1);
      expect(await f.draw()).toBe(false);
      expect(FakeWorker.instances).toHaveLength(1);
    },
  );

  it('keeps small routes and unsupported browsers on the immediate renderer', async () => {
    const f = fixture();
    expect(await f.draw(view, { steps: [step], totalLength: 1 })).toBe(false);
    vi.stubGlobal('OffscreenCanvas', undefined);
    expect(await f.draw()).toBe(false);
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('refreshes a changed raster or CNC underlay without rebuilding route commands', async () => {
    const f = fixture();
    const firstBackground = {};
    const nextBackground = {};
    await f.draw(view, route, 1, true, firstBackground);
    const worker = FakeWorker.instances[0]!;
    const first = worker.reply(request(worker));
    await f.draw(view, route, 1, true, firstBackground);
    expect(f.ctx.globalCompositeOperation).toBe('copy');
    const draws = f.drawImage.mock.calls.length;
    await f.draw(view, route, 1, true, nextBackground);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(f.drawImage).toHaveBeenCalledTimes(draws);
    expect(request(worker, 1).frame).toBeUndefined();
    expect(preparePreviewFrame).toHaveBeenCalledTimes(1);
    const final = worker.reply(request(worker, 1));
    await f.draw(view, route, 1, true, nextBackground);
    expect(f.drawImage).toHaveBeenLastCalledWith(final, 0, 0, 800, 600);
    expect(f.changed).toHaveBeenLastCalledWith(false, false);
  });

  it('closes a capture that finishes after leaving Preview and never posts it', async () => {
    let finish!: (bitmap: ImageBitmap) => void;
    vi.mocked(createImageBitmap).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const f = fixture();
    await f.draw();
    const worker = FakeWorker.instances[0]!;
    f.renderer.clear();
    const background = image();
    finish(background);
    await Promise.resolve();
    expect(background.close).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('settles a rejected underlay capture and falls back without leaving a pending view', async () => {
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('capture failed'));
    const f = fixture();
    await f.draw();
    expect(f.changed).toHaveBeenLastCalledWith(false, true);
    expect(await f.draw()).toBe(false);
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledTimes(1);
  });
});
