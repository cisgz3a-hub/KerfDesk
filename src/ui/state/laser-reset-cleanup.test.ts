import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  armResetCleanup,
  cancelResetCleanup,
  flushResetCleanup,
  type ResetCleanupRefs,
} from './laser-reset-cleanup';

afterEach(() => vi.useRealTimers());

describe('reset cleanup ownership', () => {
  it('does not continue an already-flushing cleanup after port teardown', async () => {
    vi.useFakeTimers();
    const refs: ResetCleanupRefs = { pendingResetCleanup: null };
    const writes: string[] = [];
    let finishFirstWrite = (): void => undefined;
    const firstWrite = new Promise<void>((resolve) => {
      finishFirstWrite = resolve;
    });
    const write = vi.fn(async (line: string) => {
      writes.push(line);
      if (line === 'M5\n') await firstWrite;
    });
    armResetCleanup(refs, write, ['M5', 'M9']);
    flushResetCleanup(refs, write);
    expect(writes).toEqual(['M5\n']);

    cancelResetCleanup(refs);
    finishFirstWrite();
    await vi.advanceTimersByTimeAsync(600);

    expect(writes).toEqual(['M5\n']);
  });
});
