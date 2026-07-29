import { describe, expect, it, vi } from 'vitest';
import { closeWriterBounded } from './bounded-writer-close';

function stallingWriter() {
  const calls: string[] = [];
  return {
    calls,
    close: () => {
      calls.push('close');
      return new Promise<void>(() => {
        // Never settles: models a sink that cannot drain.
      });
    },
    abort: () => {
      calls.push('abort');
      return Promise.resolve();
    },
  };
}

describe('closeWriterBounded', () => {
  it('resolves as closed when the sink drains, without aborting', async () => {
    const calls: string[] = [];
    const writer = {
      close: () => {
        calls.push('close');
        return Promise.resolve();
      },
      abort: () => {
        calls.push('abort');
        return Promise.resolve();
      },
    };

    await expect(closeWriterBounded(writer, 1_000)).resolves.toBe('closed');
    // The laser-off lines were written before teardown; a normally draining
    // writer must be allowed to flush them rather than be aborted.
    expect(calls).toEqual(['close']);
  });

  it('aborts once the deadline passes on a sink that never drains', async () => {
    vi.useFakeTimers();
    try {
      const writer = stallingWriter();
      const settled = closeWriterBounded(writer, 1_000);
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(settled).resolves.toBe('aborted');
      expect(writer.calls).toEqual(['close', 'abort']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not hang when the sink never drains — the whole point', async () => {
    vi.useFakeTimers();
    try {
      const writer = stallingWriter();
      let done = false;
      const settled = closeWriterBounded(writer, 1_000).then(() => {
        done = true;
      });

      await vi.advanceTimersByTimeAsync(999);
      expect(done).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await settled;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a rejected close as failed without aborting', async () => {
    const calls: string[] = [];
    const writer = {
      close: () => {
        calls.push('close');
        return Promise.reject(new Error('already errored'));
      },
      abort: () => {
        calls.push('abort');
        return Promise.resolve();
      },
    };

    await expect(closeWriterBounded(writer, 1_000)).resolves.toBe('failed');
    expect(calls).toEqual(['close']);
  });

  // The never-rejects contract has to survive a writer that is not a faithful
  // WritableStreamDefaultWriter — teardown must not be stranded by a stub.
  it('treats a close() that throws synchronously as failed', async () => {
    const writer = {
      close: () => {
        throw new Error('not a stream');
      },
      abort: () => Promise.resolve(),
    };

    await expect(closeWriterBounded(writer, 1_000)).resolves.toBe('failed');
  });

  it('treats a close() that returns a non-promise as closed', async () => {
    const calls: string[] = [];
    const writer = {
      close: () => {
        calls.push('close');
        return undefined as unknown as Promise<void>;
      },
      abort: () => {
        calls.push('abort');
        return Promise.resolve();
      },
    };

    await expect(closeWriterBounded(writer, 1_000)).resolves.toBe('closed');
    expect(calls).toEqual(['close']);
  });

  it('never rejects when abort itself throws', async () => {
    vi.useFakeTimers();
    try {
      const writer = {
        close: () =>
          new Promise<void>(() => {
            // Never settles.
          }),
        abort: () => Promise.reject(new Error('locked')),
      };
      const settled = closeWriterBounded(writer, 1_000);
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(settled).resolves.toBe('aborted');
    } finally {
      vi.useRealTimers();
    }
  });
});
