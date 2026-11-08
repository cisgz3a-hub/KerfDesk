// What happens when the KerfDesk window's renderer dies (ADR-482). Chromium's
// renderer can crash, run out of memory or be killed; the window then shows
// nothing and every control, Abort included, is gone. KerfDesk used to report
// that in an error box and leave the dead window behind. It now offers to
// reload, which brings back the controls and the job recovery flow. Closing
// stays with the close guard (window-close-guard.ts), which already warns that
// Abort cannot be confirmed; when a close attempt is under way the guard owns
// the choice and this offer stays out of its way.
//
// The machine is not left to the reload (rolling audit v11 W3-P1-1). Under M3,
// with a latched Fire or with a spindle, a GRBL-family controller keeps the
// output on after its last buffered move, with no timeout. Main owns a network
// session's socket, so it sends that session the stop Disconnect sends first,
// whatever the reason the renderer went. A USB port belongs to the dead
// renderer's Web Serial connection and main has no handle on it, so the prompt
// says plainly that the beam or spindle may still be on and puts the E-stop first.

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
  /** Stops and releases the network session, if any; true when there was one. */
  readonly stopMachine?: () => boolean;
  readonly askToReload: (prompt: RendererGonePrompt) => Promise<boolean>;
  readonly reportFailure?: (error: unknown) => void;
};

export type RendererGonePrompt = {
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly [string, string];
};

export const RELOAD_BUTTON = 'Reload KerfDesk';

export function rendererGonePrompt(
  reason: RendererGoneReason,
  networkStopped = false,
): RendererGonePrompt {
  const machine = networkStopped
    ? 'KerfDesk sent the network machine a reset, then M5 and M9, which stops a GRBL, ' +
      'grblHAL or FluidNC controller and turns its laser or spindle off. Check that it ' +
      'stopped. If the beam or spindle is still on, use the physical E-stop or power cutoff now.'
    : 'If a job, Fire or the laser was running, the beam or spindle may still be on. KerfDesk ' +
      'can send a USB machine nothing now: it runs the moves it already received, and a ' +
      'constant-power (M3) laser, a Fire beam or a spindle stays on after them until the ' +
      'controller is reset. Use the physical E-stop or power cutoff first.';
  return {
    message: 'The KerfDesk window stopped unexpectedly.',
    detail:
      `${machine}\n\nThen reload KerfDesk to get its controls back: connect, use Abort or ` +
      `LASER OFF, and see where the job stopped.\n\nReason: ${reasonText(reason)}.`,
    buttons: [RELOAD_BUTTON, 'Not now'],
  };
}

export function installRendererCrashRecovery(
  window: RendererCrashRecoveryTarget,
  options: RendererCrashRecoveryOptions,
): void {
  let asking = false;
  window.webContents.on('render-process-gone', (_event, details) => {
    // First, whatever follows: the stop waits on no operator or close guard.
    const networkStopped = stopMachine(options);
    if (details.reason === 'clean-exit' || asking || options.isClosing()) return;
    if (window.isDestroyed()) return;
    asking = true;
    options
      .askToReload(rendererGonePrompt(details.reason, networkStopped))
      .then((reload) => {
        if (reload && !window.isDestroyed()) window.webContents.reload();
      })
      .catch((error: unknown) => options.reportFailure?.(error))
      .finally(() => {
        asking = false;
      });
  });
}

function stopMachine(options: RendererCrashRecoveryOptions): boolean {
  try {
    return options.stopMachine?.() ?? false;
  } catch (error) {
    options.reportFailure?.(error);
    return false;
  }
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
