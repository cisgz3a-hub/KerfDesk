// Job Review's keep-awake note for a job run from a browser tab (rolling audit
// v11 W9-P2-1, ADR-117 Amendment 1). A browser keeps the computer awake only
// while KerfDesk's tab is visible: hidden or minimised, the browser releases
// the screen wake lock and refuses a new one, and nothing else stops the
// computer's sleep timer. A sleeping computer stops the stream, and under
// constant power the controller keeps the beam on over the stopped head. The
// desktop app keeps its page visible while minimised (ADR-354 Amendment 1), so
// it never shows this. Advisory only, never a Start gate (ADR-565).

import type { LaserState } from '../../state/laser-store';

export const BROWSER_KEEP_AWAKE_WARNING =
  'This job runs from a browser tab. Keep KerfDesk in front until it ends: in a background tab or a minimised window the browser lets the computer sleep, which stops the job, and a constant-power (M3) beam stays on over the stopped head. For long jobs, turn off sleep in your power settings or use the desktop app.';

export function browserKeepAwakeWarnings(
  live: Pick<LaserState, 'connection' | 'connectionHost'>,
): ReadonlyArray<string> {
  if (live.connection.kind !== 'connected' || live.connectionHost !== 'web') return [];
  return [BROWSER_KEEP_AWAKE_WARNING];
}
