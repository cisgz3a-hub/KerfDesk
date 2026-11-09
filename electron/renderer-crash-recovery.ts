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
//
// The stop's listener is prepended (rolling audit v12 X1-P2-1). Node calls a
// listener in the order it was added, and the close guard, added earlier, can
// block the main thread on its synchronous "App controls unavailable" box when
// the renderer dies during a close; the reset is written before that box opens.
// The prompt says only what was written: it waits for the reset's write, which
// is bounded, and says so plainly when the session's socket could not take it
// (X1-P3-1).

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
    prependListener(event: 'render-process-gone', listener: () => void): unknown;
    reload(): void;
  };
};

/** How many network sessions there were, and how many took the reset. */
export type MachineStopReport = { readonly sessions: number; readonly sent: number };

const NO_SESSION: MachineStopReport = { sessions: 0, sent: 0 };

export type RendererCrashRecoveryOptions = {
  readonly isClosing: () => boolean;
  /** Stops and releases the network session, if any; its writes start before it returns. */
  readonly stopMachine?: () => Promise<MachineStopReport>;
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
  stop: MachineStopReport = NO_SESSION,
): RendererGonePrompt {
  const machine =
    stop.sent > 0
      ? 'KerfDesk sent the network machine a reset, which stops a GRBL, grblHAL or FluidNC ' +
        'controller and turns its laser or spindle off, and follows it with M5 and M9. Check ' +
        'that it stopped. If the beam or spindle is still on, use the physical E-stop or power ' +
        'cutoff now.'
      : stop.sessions > 0
        ? 'KerfDesk could not send the network machine a stop: its connection had already ' +
          'failed. If a job, Fire or the laser was running, the beam or spindle may still be ' +
          'on. Use the physical E-stop or power cutoff first.'
        : 'If a job, Fire or the laser was running, the beam or spindle may still be on. ' +
          'KerfDesk can send a USB machine nothing now: it runs the moves it already received, ' +
          'and a constant-power (M3) laser, a Fire beam or a spindle stays on after them until ' +
          'the controller is reset. Use the physical E-stop or power cutoff first.';
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
  let stopped: Promise<MachineStopReport> = Promise.resolve(NO_SESSION);
  // Before every other listener: the stop waits on no operator or close guard.
  window.webContents.prependListener('render-process-gone', () => {
    stopped = stopMachine(options);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || asking || options.isClosing()) return;
    if (window.isDestroyed()) return;
    asking = true;
    stopped
      .then((stop) => options.askToReload(rendererGonePrompt(details.reason, stop)))
      .then((reload) => {
        if (reload && !window.isDestroyed()) window.webContents.reload();
      })
      .catch((error: unknown) => options.reportFailure?.(error))
      .finally(() => {
        asking = false;
      });
  });
}

function stopMachine(options: RendererCrashRecoveryOptions): Promise<MachineStopReport> {
  const failed = (error: unknown): MachineStopReport => {
    options.reportFailure?.(error);
    return NO_SESSION;
  };
  try {
    return (options.stopMachine?.() ?? Promise.resolve(NO_SESSION)).catch(failed);
  } catch (error) {
    return Promise.resolve(failed(error));
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
