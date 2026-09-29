import { describe, expect, it, vi } from 'vitest';
import { createDesktopWindowReopener } from './desktop-window-reopen.js';

describe('desktop window reopening', () => {
  it('does not open before startup, during quit or beside an existing window', () => {
    const createWindow = vi.fn(async () => undefined);
    for (const [ready, quitting, present] of [
      [false, false, false],
      [true, true, false],
      [true, false, true],
    ]) {
      createDesktopWindowReopener({
        isReady: () => ready === true,
        isQuitting: () => quitting === true,
        hasWindow: () => present === true,
        createWindow,
        onError: vi.fn(),
      })();
    }
    expect(createWindow).not.toHaveBeenCalled();
  });

  it('coalesces an OS-open and activation, and recovers after creation rejects', async () => {
    const failure = new Error('renderer load failed');
    const onError = vi.fn();
    const createWindow = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const reopen = createDesktopWindowReopener({
      isReady: () => true,
      isQuitting: () => false,
      hasWindow: () => false,
      createWindow,
      onError,
    });
    reopen();
    reopen();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    expect(createWindow).toHaveBeenCalledOnce();
    reopen();
    await vi.waitFor(() => expect(createWindow).toHaveBeenCalledTimes(2));
  });

  it.each(['quit', 'window', 'startup'])(
    'does not reopen when %s state changes before creation',
    async (change) => {
      let ready = true;
      let quitting = false;
      let present = false;
      const createWindow = vi.fn(async () => undefined);
      const reopen = createDesktopWindowReopener({
        isReady: () => ready,
        isQuitting: () => quitting,
        hasWindow: () => present,
        createWindow,
        onError: vi.fn(),
      });
      reopen();
      if (change === 'quit') quitting = true;
      if (change === 'window') present = true;
      if (change === 'startup') ready = false;
      await Promise.resolve();
      expect(createWindow).not.toHaveBeenCalled();
    },
  );
});
