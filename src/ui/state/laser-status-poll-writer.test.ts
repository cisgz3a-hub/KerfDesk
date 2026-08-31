import { describe, expect, it, vi } from 'vitest';
import { createLaserStatusPollWriter } from './laser-status-poll-writer';

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let finish: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { promise, resolve: () => finish?.() };
}

describe('createLaserStatusPollWriter', () => {
  it('drops overlapping ticks and accepts the next query after settlement', async () => {
    const pending = deferred();
    const write = vi.fn(() => pending.promise);
    const poll = createLaserStatusPollWriter(write);

    const first = poll('?');
    await poll('?');
    expect(write).toHaveBeenCalledTimes(1);

    pending.resolve();
    await first;
    await poll('?');
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('releases the next tick after a transport rejection', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('fixture')).mockResolvedValue(undefined);
    const poll = createLaserStatusPollWriter(write);

    await expect(poll('?')).resolves.toBeUndefined();
    await expect(poll('?')).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(2);
  });
});
