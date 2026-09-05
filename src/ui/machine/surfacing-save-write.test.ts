import { describe, expect, it, vi } from 'vitest';
import type { SaveTarget } from '../../platform/types';
import { writeSurfacingFile } from './surfacing-save-write';

const chunks = {
  async *[Symbol.asyncIterator]() {
    yield 'complete program';
  },
};
function options(controller = new AbortController()) {
  return { signal: controller.signal, onWriting: vi.fn(), onFinalizing: vi.fn() };
}
describe('surfacing save commit ownership', () => {
  it('settles an old final commit before a replacement opens its writer', async () => {
    let finishOldClose: () => void = () => undefined;
    const oldClose = new Promise<void>((resolve) => {
      finishOldClose = resolve;
    });
    const committed: string[] = [];
    const old: SaveTarget = {
      displayName: 'same.nc',
      write: async () => undefined,
      writeChunks: async (_chunks, _signal, onFinalizing) => {
        onFinalizing?.();
        await oldClose;
        committed.push('old');
      },
    };
    const replacementWrite = vi.fn(async () => {
      committed.push('new');
    });
    const replacement: SaveTarget = {
      displayName: 'same.nc',
      write: async () => undefined,
      writeChunks: replacementWrite,
    };
    const controller = new AbortController();
    const firstOptions = options(controller);
    const first = writeSurfacingFile(old, chunks, firstOptions);
    await vi.waitFor(() => expect(firstOptions.onFinalizing).toHaveBeenCalledOnce());
    controller.abort(); // close already owns an irrevocable full-file commit
    const second = writeSurfacingFile(replacement, chunks, options());
    await Promise.resolve();
    expect(replacementWrite).not.toHaveBeenCalled();
    finishOldClose();
    await Promise.all([first, second]);
    expect(committed).toEqual(['old', 'new']);
  });

  it('releases the next save after a write failure and skips cancelled queued work', async () => {
    let rejectFirst: (error: Error) => void = () => undefined;
    const failure = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const failedTarget: SaveTarget = {
      displayName: 'failed.nc',
      write: async () => undefined,
      writeChunks: () => failure,
    };
    const first = writeSurfacingFile(failedTarget, chunks, options());
    const rejected = expect(first).rejects.toThrow('disk full');
    const cancelledWrite = vi.fn(async () => undefined);
    const controller = new AbortController();
    const second = writeSurfacingFile(
      {
        displayName: 'cancelled.nc',
        write: async () => undefined,
        writeChunks: cancelledWrite,
      },
      chunks,
      options(controller),
    );
    const cancelled = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    rejectFirst(new Error('disk full'));
    await Promise.all([rejected, cancelled]);
    expect(cancelledWrite).not.toHaveBeenCalled();
    const finalWrite = vi.fn(async () => undefined);
    await writeSurfacingFile(
      { displayName: 'last.nc', write: async () => undefined, writeChunks: finalWrite },
      chunks,
      options(),
    );
    expect(finalWrite).toHaveBeenCalledOnce();
  });
});
