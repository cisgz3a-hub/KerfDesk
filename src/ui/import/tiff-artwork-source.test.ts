import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTiffArtwork } from './tiff-artwork-source';

class ControlledWorker {
  static latest: ControlledWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    ControlledWorker.latest = this;
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('TIFF worker lifetime', () => {
  it.each(['onerror', 'onmessageerror'] as const)(
    'rejects active and later page requests after %s instead of waiting on a dead worker',
    async (failure) => {
      vi.stubGlobal('Worker', ControlledWorker);
      const file = new File([], 'scan.tif');
      Object.defineProperty(file, 'arrayBuffer', {
        value: async () => new ArrayBuffer(8),
      });
      const opening = openTiffArtwork(file);
      await vi.waitFor(() => expect(ControlledWorker.latest.postMessage).toHaveBeenCalledOnce());
      const worker = ControlledWorker.latest;
      worker.onmessage?.({ data: { id: 1, pageCount: 2 } } as MessageEvent);
      const source = await opening;
      const page = source.prepare(1);
      const rejected = expect(page).rejects.toThrow('TIFF import closed');
      worker[failure]?.();
      await rejected;
      await expect(source.prepare(2)).rejects.toThrow('Reopen the file');
      expect(worker.postMessage).toHaveBeenCalledTimes(2);
      expect(worker.terminate).toHaveBeenCalledOnce();
    },
  );
});
