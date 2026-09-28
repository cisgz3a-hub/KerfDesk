// What happens when the KerfDesk window's renderer dies (ADR-482). Chromium's
// renderer can crash, run out of memory or be killed; the window then shows
// nothing and every control, Abort included, is gone. KerfDesk used to report
// that in an error box and leave the dead window behind. It now offers to
// reload, which brings back the controls and the job recovery flow. Closing
// stays with the close guard (window-close-guard.ts), which already warns that
// Abort cannot be confirmed; when a close attempt is under way the guard owns
// the choice and this offer stays out of its way.

export type RendererGoneReason =
  | 'clean-exit'
  | 'abnormal-exit'
  | 'killed'
  | 'crashed'
  | 'oom'
  | 'launch-failed'
  | 'integrity-failure'
  | 'memory-eviction';

export type RendererCrashRecoveryTarget = {
  readonly isDestroyed: () => boolean;
  readonly webContents: {
    on(
      event: 'render-process-gone',
      listener: (event: unknown, details: { readonly reason: RendererGoneReason }) => void,
    ): unknown;
    reload(): void;
  };
};

export type RendererCrashRecoveryOptions = {
  readonly isClosing: () => boolean;
  readonly askToReload: (prompt: RendererGonePrompt) => Promise<boolean>;
  readonly reportFailure?: (error: unknown) => void;
};

export type RendererGonePrompt = {
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly [string, string];
};

export const RELOAD_BUTTON = 'Reload KerfDesk';

export function rendererGonePrompt(reason: RendererGoneReason): RendererGonePrompt {
  return {
    message: 'The KerfDesk window stopped unexpectedly.',
    detail:
      'Reload KerfDesk to get its controls back and see where a running job stopped. ' +
      'A job that was streaming is no longer being sent; the machine may still finish ' +
      'moves it already received. Use the physical E-stop or power cutoff if the ' +
      `machine may be unsafe.\n\nReason: ${reasonText(reason)}.`,
    buttons: [RELOAD_BUTTON, 'Not now'],
  };
}

export function installRendererCrashRecovery(
  window: RendererCrashRecoveryTarget,
  options: RendererCrashRecoveryOptions,
): void {
  let asking = false;
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || asking || options.isClosing()) return;
    if (window.isDestroyed()) return;
    asking = true;
    options
      .askToReload(rendererGonePrompt(details.reason))
      .then((reload) => {
        if (reload && !window.isDestroyed()) window.webContents.reload();
      })
      .catch((error: unknown) => options.reportFailure?.(error))
      .finally(() => {
        asking = false;
      });
  });
}

function reasonText(reason: RendererGoneReason): string {
  switch (reason) {
    case 'oom':
      return 'it ran out of memory';
    case 'crashed':
      return 'it crashed';
    case 'killed':
      return 'it was ended by the system or another program';
    case 'launch-failed':
      return 'it could not start';
    case 'integrity-failure':
      return 'its code failed an integrity check';
    case 'memory-eviction':
      return 'the system reclaimed its memory';
    case 'abnormal-exit':
    case 'clean-exit':
      return 'it exited unexpectedly';
  }
}
