import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageLumaRequest, ImageLumaResponse } from './image-luma-decode';

// Count-based guard for S3-P2-1: an embedded photo import must not run the
// per-pixel decode, composite or luma loop on the UI thread when the import
// worker can do it. The UI-thread entry points are counted here.
const loader = vi.hoisted(() => ({
  burnDecodeMaxEdge: vi.fn(() => 8192),
  extractLumaBase64: vi.fn(() => 'ui-thread-luma'),
  loadImageAsRawData: vi.fn(async () => ({
    width: 4000,
    height: 3000,
    data: new Uint8ClampedArray(4),
  })),
  readBurnDecodePlan: vi.fn(async () => ({ target: { width: 4000, height: 3000 }, resize: false })),
  readImageNaturalSize: vi.fn(async () => ({ width: 4000, height: 3000 })),
}));
vi.mock('../trace/image-loader', () => loader);

import { loadImageSamples } from './prepare-image-samples';

type Reply = (request: ImageLumaRequest) => ImageLumaResponse;

const workers: FakeWorker[] = [];
let reply: Reply = () => ({ kind: 'fallback', reason: 'unset' });
let deliver: 'microtask' | 'manual' = 'microtask';
let pendingAnswer: (() => void) | null = null;

class FakeWorker {
  onmessage: ((event: MessageEvent<ImageLumaResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly requests: ImageLumaRequest[] = [];
  terminated = false;
  constructor(readonly url: URL) {
    workers.push(this);
  }
  postMessage(request: ImageLumaRequest): void {
    this.requests.push(request);
    const answer = (): void => this.onmessage?.({ data: reply(request) } as MessageEvent);
    if (deliver === 'manual') pendingAnswer = answer;
    else queueMicrotask(answer);
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe('loadImageSamples: embedded photo decode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workers.length = 0;
    deliver = 'microtask';
    pendingAnswer = null;
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('OffscreenCanvas', vi.fn());
    vi.stubGlobal('createImageBitmap', vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('runs no per-pixel loop on the UI thread when the worker decodes', async () => {
    reply = (request) => ({
      kind: 'ok',
      width: request.target?.width ?? 0,
      height: request.target?.height ?? 0,
      lumaBase64: 'worker-luma',
    });
    const file = new File(['jpeg'], 'phone.jpg', { type: 'image/jpeg' });

    const loaded = await loadImageSamples(file, false, false);

    expect(loader.loadImageAsRawData).toHaveBeenCalledTimes(0);
    expect(loader.extractLumaBase64).toHaveBeenCalledTimes(0);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.url.pathname).toMatch(/image-luma-worker/);
    expect(workers[0]?.requests).toEqual([
      { file, target: { width: 4000, height: 3000 }, resize: false, maxEdge: 8192 },
    ]);
    expect(workers[0]?.terminated).toBe(true);
    expect(loaded).toEqual({
      kind: 'embedded',
      natural: { width: 4000, height: 3000 },
      sampled: { width: 4000, height: 3000 },
      lumaBase64: 'worker-luma',
    });
  });

  it('falls back to the UI-thread loader once when the worker declines', async () => {
    reply = () => ({ kind: 'fallback', reason: 'engine ignored the orientation' });

    const loaded = await loadImageSamples(new File(['jpeg'], 'turned.jpg'), false, false);

    expect(loader.loadImageAsRawData).toHaveBeenCalledTimes(1);
    expect(loader.extractLumaBase64).toHaveBeenCalledTimes(1);
    expect(loaded).toMatchObject({ kind: 'embedded', lumaBase64: 'ui-thread-luma' });
  });

  it('cancels the worker on Esc without decoding on the UI thread', async () => {
    deliver = 'manual';
    reply = () => ({ kind: 'ok', width: 1, height: 1, lumaBase64: 'late' });
    const controller = new AbortController();
    const pending = loadImageSamples(new File(['jpeg'], 'big.jpg'), false, false, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0]?.terminated).toBe(true);
    expect(loader.loadImageAsRawData).not.toHaveBeenCalled();
  });

  it('announces a slow decode once, so the import can show progress and Cancel', async () => {
    deliver = 'manual';
    reply = () => ({ kind: 'ok', width: 1, height: 1, lumaBase64: 'x' });
    const onSlowDecode = vi.fn();
    vi.useFakeTimers();
    const pending = loadImageSamples(new File(['jpeg'], 'slow.jpg'), false, false, {
      onSlowDecode,
    });
    await vi.waitFor(() => expect(pendingAnswer).not.toBeNull());
    expect(onSlowDecode).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(onSlowDecode).toHaveBeenCalledOnce();
    pendingAnswer?.();

    await expect(pending).resolves.toMatchObject({ lumaBase64: 'x' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSlowDecode).toHaveBeenCalledOnce();
  });
});
