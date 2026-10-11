import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { photoPreviewFixture } from './photo-engraving-preview.test-support';
import {
  previewPhotoEngravingInWorker,
  resetPhotoEngravingPreviewWorkerForTests,
} from './photo-engraving-preview-worker-client';
import type {
  PhotoEngravingPreviewWorkerRequest,
  PhotoEngravingPreviewWorkerResponse,
} from './photo-engraving-preview-worker-protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<PhotoEngravingPreviewWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  request: PhotoEngravingPreviewWorkerRequest | undefined;
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(request: PhotoEngravingPreviewWorkerRequest): void {
    this.request = request;
  }
  finish(message = 'Test result'): void {
    this.onmessage?.({
      data: { id: this.request?.id, result: { kind: 'error', message } },
    } as MessageEvent<PhotoEngravingPreviewWorkerResponse>);
  }
}

function latest(): FakeWorker {
  const worker = FakeWorker.instances.at(-1);
  if (worker === undefined) throw new Error('Expected worker');
  return worker;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  resetPhotoEngravingPreviewWorkerForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('photo preview request ownership', () => {
  it('retires superseded work and late callbacks cannot change the replacement', async () => {
    const first = previewPhotoEngravingInWorker(photoPreviewFixture());
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const old = latest();
    const lateReply = old.onmessage;
    const lateError = old.onerror;
    const second = previewPhotoEngravingInWorker(photoPreviewFixture());
    const current = latest();
    await rejected;
    expect(old.terminate).toHaveBeenCalledOnce();
    lateReply?.({
      data: { id: old.request?.id, result: { kind: 'error', message: 'stale' } },
    } as MessageEvent<PhotoEngravingPreviewWorkerResponse>);
    lateError?.();
    expect(current.terminate).not.toHaveBeenCalled();
    current.finish('current');
    await expect(second).resolves.toEqual({ kind: 'error', message: 'current' });
    expect(current.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts the exact request without a UI-thread fallback', async () => {
    const controller = new AbortController();
    const result = previewPhotoEngravingInWorker(photoPreviewFixture(), controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    const worker = latest();
    controller.abort();
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    vi.stubGlobal('Worker', undefined);
    await expect(previewPhotoEngravingInWorker(photoPreviewFixture())).resolves.toMatchObject({
      kind: 'error',
      message: expect.stringContaining('unavailable'),
    });
  });

  it('leaves current work running when a new request was already aborted', async () => {
    const result = previewPhotoEngravingInWorker(photoPreviewFixture());
    const worker = latest();
    const controller = new AbortController();
    controller.abort();
    await expect(
      previewPhotoEngravingInWorker(photoPreviewFixture(), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.finish();
    await result;
  });

  it('budgets before spawning and excludes display bytes and unrelated images from cloning', async () => {
    const input = photoPreviewFixture();
    await expect(
      previewPhotoEngravingInWorker({ ...input, image: { ...input.image, pixelWidth: 1e9 } }),
    ).resolves.toMatchObject({ kind: 'error' });
    expect(FakeWorker.instances).toHaveLength(0);
    const result = previewPhotoEngravingInWorker(input, undefined, 5000);
    const worker = latest();
    expect(worker.request?.input.image.dataUrl).toBeUndefined();
    expect(worker.request?.input.image.lumaBase64).toBe(input.image.lumaBase64);
    expect(worker.request?.input.sceneObjects).toEqual([]);
    expect(worker.request?.maxEdge).toBe(1000);
    worker.finish();
    await result;
  });

  it.each(['timeout', 'error', 'messageerror', 'post'] as const)(
    'retires %s failures and reports them as preview errors',
    async (failure) => {
      if (failure === 'post')
        vi.spyOn(FakeWorker.prototype, 'postMessage').mockImplementationOnce(() => {
          throw new Error('Post failed');
        });
      const result = previewPhotoEngravingInWorker(photoPreviewFixture());
      const worker = latest();
      if (failure === 'timeout') await vi.advanceTimersByTimeAsync(30_000);
      if (failure === 'error') worker.onerror?.();
      if (failure === 'messageerror') worker.onmessageerror?.();
      await expect(result).resolves.toMatchObject({ kind: 'error' });
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
