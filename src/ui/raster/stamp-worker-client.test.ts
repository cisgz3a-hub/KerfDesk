import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareStampInWorker } from './stamp-worker-client';
class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.latest = this;
  }
}
afterEach(() => vi.unstubAllGlobals());
const input = {
  source: { width: 1, height: 1, widthMm: 1, heightMm: 1, luma: new Uint8Array([0]) },
  request: { threshold: 127, taperMm: 1, mirror: false },
};
describe('stamp worker ownership', () => {
  it('terminates on cancellation and ignores late success without detaching source pixels', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const controller = new AbortController();
    const result = prepareStampInWorker(input, controller.signal);
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    const worker = FakeWorker.latest;
    controller.abort();
    worker.onmessage?.({ data: { kind: 'ok', draft: { dataUrl: 'late' } } } as MessageEvent);
    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.postMessage.mock.calls[0]).toHaveLength(1);
    expect(input.source.luma[0]).toBe(0);
  });
  it('retires failed workers and has no blocking fallback', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const result = prepareStampInWorker(input, new AbortController().signal);
    FakeWorker.latest.onerror?.();
    await expect(result).rejects.toThrow('worker failed');
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
});
