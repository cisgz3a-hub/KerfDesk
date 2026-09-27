import { describe, expect, it, vi } from 'vitest';
import {
  installRendererCrashRecovery,
  RELOAD_BUTTON,
  rendererGonePrompt,
  type RendererGoneReason,
} from './renderer-crash-recovery';

function crashTarget() {
  let listener: ((event: unknown, details: { reason: RendererGoneReason }) => void) | undefined;
  const window = {
    destroyed: false,
    isDestroyed: () => window.destroyed,
    webContents: {
      on: vi.fn((_event: 'render-process-gone', next: typeof listener) => {
        listener = next;
      }),
      reload: vi.fn(),
    },
  };
  const crash = (reason: RendererGoneReason): void => listener?.({}, { reason });
  return { window, crash };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('renderer crash recovery', () => {
  it('offers a reload after a crash and reloads on request', async () => {
    const { window, crash } = crashTarget();
    const askToReload = vi.fn(async () => true);
    installRendererCrashRecovery(window, { isClosing: () => false, askToReload });

    crash('oom');
    await settle();

    expect(askToReload).toHaveBeenCalledWith(rendererGonePrompt('oom'));
    expect(window.webContents.reload).toHaveBeenCalledOnce();
  });

  it('keeps the window as it is when the operator says not now', async () => {
    const { window, crash } = crashTarget();
    installRendererCrashRecovery(window, {
      isClosing: () => false,
      askToReload: async () => false,
    });
    crash('crashed');
    await settle();
    expect(window.webContents.reload).not.toHaveBeenCalled();
  });

  it('leaves a close attempt and a normal exit to their own owners', async () => {
    const { window, crash } = crashTarget();
    const askToReload = vi.fn(async () => true);
    let closing = true;
    installRendererCrashRecovery(window, { isClosing: () => closing, askToReload });

    crash('crashed');
    closing = false;
    crash('clean-exit');
    window.destroyed = true;
    crash('killed');
    await settle();

    expect(askToReload).not.toHaveBeenCalled();
  });

  it('asks once while a prompt is still open', async () => {
    const { window, crash } = crashTarget();
    let answer: (reload: boolean) => void = () => undefined;
    const askToReload = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    installRendererCrashRecovery(window, { isClosing: () => false, askToReload });

    crash('crashed');
    crash('crashed');
    answer(true);
    await settle();
    crash('oom');

    expect(askToReload).toHaveBeenCalledTimes(2);
  });

  it('names Reload first and keeps the safety instruction', () => {
    const prompt = rendererGonePrompt('killed');
    expect(prompt.buttons[0]).toBe(RELOAD_BUTTON);
    expect(prompt.detail).toContain('physical E-stop or power cutoff');
    expect(prompt.detail).toContain('ended by the system');
  });
});
