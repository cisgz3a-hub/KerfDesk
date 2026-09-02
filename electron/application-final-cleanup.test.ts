import { describe, expect, it, vi } from 'vitest';
import { installApplicationFinalCleanup } from './application-final-cleanup';

describe('desktop application final cleanup', () => {
  it('starts cleanup only after every window accepted the quit', () => {
    const listeners = new Map<string, () => void>();
    const cleanup = vi.fn(() => Promise.resolve());
    installApplicationFinalCleanup(
      {
        on: vi.fn((event, listener) => listeners.set(event, listener)),
      },
      cleanup,
    );

    expect(listeners.has('before-quit')).toBe(false);
    expect(listeners.has('will-quit')).toBe(true);
    expect(cleanup).not.toHaveBeenCalled();

    listeners.get('will-quit')?.();
    listeners.get('will-quit')?.();

    expect(cleanup).toHaveBeenCalledOnce();
  });
});
