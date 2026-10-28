// What the operator is told when background streaming (ADR-354) is unavailable
// depends on the host. Without the worker, sending runs on the window's main
// thread. A browser throttles a hidden tab or minimised window, so the operator
// must keep KerfDesk visible. The desktop window keeps its page visible while
// minimised (backgroundThrottling off, ADR-362), so the same transport keeps
// sending and there is nothing to ask of the operator (ADR-354 Amendment 1).
// The adapter id is the same UI-chrome signal that hides the desktop download
// link; no transport code reads it.
//
// On every host the window's thread also runs edits, Undo, imports and
// renders. A stall there stops the refill, the controller runs out of moves,
// and under constant power the beam stays on over the stopped head (rolling
// audit v6 K1). So every host now shows the fallback as a notice, not only a
// log line, and names that risk (ADR-676). Job Review says whether the job
// about to run is affected.

import type { PlatformAdapter } from '../../platform/types';

type Host = PlatformAdapter['id'] | undefined;

function hiddenWindowPausesSending(host: Host): boolean {
  return host !== 'electron';
}

/** The Laser log's record of a requested worker transport that fell back to the window. */
export const BACKGROUND_STREAMING_FALLBACK_LOG =
  '[lf2] Background streaming is unavailable for this connection; sending runs in the KerfDesk window.';

/** The Laser log's record of a connection whose profile turned background streaming off. */
export const BACKGROUND_STREAMING_OFF_LOG =
  '[lf2] Background streaming is off in Machine Setup; sending runs in the KerfDesk window.';

const LIT_STOP_RISK =
  'If the window is busy (a large edit, Undo or import), the controller can run out of moves and stop, and with constant power the beam stays on over the stopped head. Job Review says whether a job is affected.';

/** The connect notice for that fallback. */
export function backgroundStreamingFallbackWarning(host: Host): string {
  const visible = hiddenWindowPausesSending(host)
    ? ' Keep KerfDesk visible while sending the job.'
    : '';
  return `Background streaming is unavailable for this connection, so KerfDesk sends the job from its window.${visible} ${LIT_STOP_RISK}`;
}

/** Machine Setup's hint for the Background streaming preference. */
export function backgroundStreamingPreferenceTitle(host: Host): string {
  const fallback = hiddenWindowPausesSending(host)
    ? ' If unavailable, keep KerfDesk visible during transfer.'
    : '';
  return `Keeps G-code sending independent of a busy window when supported. Without it, a busy window can stop the machine with a constant-power beam still on.${fallback} Reconnect after changing this setting.`;
}
