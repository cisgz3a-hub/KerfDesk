import { describe, expect, it, vi } from 'vitest';

import {
  AUTOSAVE_FILE_CLEANUP_WARNING,
  clearAutosaveAfterFileHandoff,
} from './autosave-file-cleanup';

describe('clearAutosaveAfterFileHandoff', () => {
  it('does not delay a successful file handoff while cleanup is pending', async () => {
    let finish = (_result: { readonly kind: 'ok' }): void => undefined;
    const pending = new Promise<{ readonly kind: 'ok' }>((resolve) => {
      finish = resolve;
    });
    const pushToast = vi.fn();

    clearAutosaveAfterFileHandoff(pushToast, { clearCurrent: () => pending });

    expect(pushToast).not.toHaveBeenCalled();
    finish({ kind: 'ok' });
    await pending;
    await Promise.resolve();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('warns without reclassifying a completed handoff when cleanup fails', async () => {
    const pushToast = vi.fn();
    const pending = Promise.resolve({
      kind: 'failed',
      error: new Error('storage failed'),
    } as const);

    clearAutosaveAfterFileHandoff(pushToast, { clearCurrent: () => pending });
    await pending;
    await vi.waitFor(() => {
      expect(pushToast).toHaveBeenCalledWith(AUTOSAVE_FILE_CLEANUP_WARNING, 'warning');
    });
  });

  it('contains a synchronous cleanup exception behind the completed handoff', async () => {
    const pushToast = vi.fn();

    expect(() =>
      clearAutosaveAfterFileHandoff(pushToast, {
        clearCurrent: () => {
          throw new DOMException('storage blocked', 'SecurityError');
        },
      }),
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(pushToast).toHaveBeenCalledWith(AUTOSAVE_FILE_CLEANUP_WARNING, 'warning');
  });
});
