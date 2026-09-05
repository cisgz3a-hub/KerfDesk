import { describe, expect, it, vi } from 'vitest';
import { writeSaveChunks } from './write-save-chunks';

function stream() {
  const write = vi.fn(async (_chunk: string): Promise<void> => undefined);
  const close = vi.fn(async () => undefined);
  const abort = vi.fn(async () => undefined);
  return {
    write,
    close,
    abort,
    writable: { write, close, abort } as unknown as FileSystemWritableFileStream,
  };
}
describe('transactional streamed saves', () => {
  it('does not request another chunk until the current write settles', async () => {
    const target = stream();
    let finishWrite: () => void = () => undefined;
    target.write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    let requested = 0;
    const chunks = {
      async *[Symbol.asyncIterator]() {
        requested++;
        yield 'first';
        requested++;
        yield 'second';
      },
    };
    const save = writeSaveChunks(target.writable, chunks);
    await vi.waitFor(() => expect(target.write).toHaveBeenCalledOnce());
    expect(requested).toBe(1);
    expect(target.close).not.toHaveBeenCalled();
    finishWrite();
    await save;
    expect(requested).toBe(2);
    expect(target.close).toHaveBeenCalledOnce();
  });

  it('aborts without closing when generation fails after some bytes were staged', async () => {
    const target = stream();
    const chunks = {
      async *[Symbol.asyncIterator]() {
        yield 'first';
        throw new Error('generation failed');
      },
    };
    await expect(writeSaveChunks(target.writable, chunks)).rejects.toThrow('generation failed');
    expect(target.abort).toHaveBeenCalledOnce();
    expect(target.close).not.toHaveBeenCalled();
  });

  it('discards staged bytes on cancellation and does not consume later chunks', async () => {
    const target = stream();
    const controller = new AbortController();
    let reachedEnd = false;
    target.write.mockImplementationOnce(async () => {
      controller.abort();
    });
    const chunks = {
      async *[Symbol.asyncIterator]() {
        yield 'first';
        yield 'second';
        reachedEnd = true;
      },
    };
    await expect(writeSaveChunks(target.writable, chunks, controller.signal)).rejects.toMatchObject(
      { name: 'AbortError' },
    );
    expect(target.write).toHaveBeenCalledOnce();
    expect(target.close).not.toHaveBeenCalled();
    expect(target.abort).toHaveBeenCalled();
    expect(reachedEnd).toBe(false);
  });

  it('reports disk failures and aborts the pending transaction', async () => {
    const target = stream();
    target.write.mockRejectedValueOnce(new Error('disk full'));
    const chunks = {
      async *[Symbol.asyncIterator]() {
        yield 'first';
      },
    };
    await expect(writeSaveChunks(target.writable, chunks)).rejects.toThrow('disk full');
    expect(target.abort).toHaveBeenCalledOnce();
    expect(target.close).not.toHaveBeenCalled();
  });

  it('announces irrevocable finalization before a real deferred close and ignores late abort', async () => {
    let finishClose: () => void = () => undefined;
    const closeGate = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    let committed = 'original contents';
    let staged = '';
    const close = vi.fn(async () => {
      await closeGate;
      committed = staged;
    });
    const actual = new WritableStream<string>({
      write: (chunk) => {
        staged += chunk;
      },
      close,
    });
    const writer = actual.getWriter();
    const abort = vi.fn(async () => writer.abort());
    const writable = {
      write: (chunk: string) => writer.write(chunk),
      close: () => writer.close(),
      abort,
    } as unknown as FileSystemWritableFileStream;
    const controller = new AbortController();
    const finalizing = vi.fn(() => {
      expect(staged).toBe('complete output');
      expect(close).not.toHaveBeenCalled();
    });
    const chunks = {
      async *[Symbol.asyncIterator]() {
        yield 'complete output';
      },
    };
    const save = writeSaveChunks(writable, chunks, controller.signal, finalizing);
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(finalizing).toHaveBeenCalledOnce();
    expect(committed).toBe('original contents');
    controller.abort();
    expect(abort).not.toHaveBeenCalled();
    finishClose();
    await expect(save).resolves.toBeUndefined();
    expect(committed).toBe('complete output');
  });

  it('retains cleanup and reports a close failure after finalization starts', async () => {
    const target = stream();
    target.close.mockRejectedValueOnce(new Error('commit failed'));
    const finalizing = vi.fn();
    const chunks = {
      async *[Symbol.asyncIterator]() {
        yield 'complete output';
      },
    };
    await expect(writeSaveChunks(target.writable, chunks, undefined, finalizing)).rejects.toThrow(
      'commit failed',
    );
    expect(finalizing).toHaveBeenCalledOnce();
    expect(target.abort).toHaveBeenCalledOnce();
  });
});
