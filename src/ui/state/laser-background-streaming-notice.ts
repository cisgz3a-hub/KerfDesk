// What the operator is told when background streaming (ADR-354) is unavailable
// depends on the host. Without the worker, sending runs on the window's main
// thread. A browser throttles a hidden tab or minimised window, so the operator
// must keep KerfDesk visible. The desktop window keeps its page visible while
// minimised (backgroundThrottling off, ADR-362), so the same transport keeps
// sending and there is nothing to ask of the operator (ADR-354 Amendment 1).
// The adapter id is the same UI-chrome signal that hides the desktop download
// link; no transport code reads it.

import type { PlatformAdapter } from '../../platform/types';

type Host = PlatformAdapter['id'] | undefined;

function hiddenWindowPausesSending(host: Host): boolean {
  return host !== 'electron';
}

/** The Laser log's record of a requested worker transport that fell back to the window. */
export const BACKGROUND_STREAMING_FALLBACK_LOG =
  '[lf2] Background streaming is unavailable for this connection; sending runs in the KerfDesk window.';

/** The connect toast for that fallback, or null where a minimised window keeps sending. */
export function backgroundStreamingFallbackWarning(host: Host): string | null {
  return hiddenWindowPausesSending(host)
    ? 'Background streaming is unavailable for this connection. Keep KerfDesk visible while sending the job.'
    : null;
}

/** Machine Setup's hint for the Background streaming preference. */
export function backgroundStreamingPreferenceTitle(host: Host): string {
  const fallback = hiddenWindowPausesSending(host)
    ? ' If unavailable, keep KerfDesk visible during transfer.'
    : '';
  return `Keeps G-code sending independent of a busy window when supported.${fallback} Reconnect after changing this setting.`;
}
