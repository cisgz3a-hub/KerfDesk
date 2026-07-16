// Passive C6 follow-up: GRBL never names the active WCS in status frames —
// only a [GC:...] modal report (the $G response) reveals it. Observing every
// modal report that crosses the line pipeline (the qualified-connect probe,
// owned Work-Z readbacks, an operator-typed $G) lets the Start-time G54
// mismatch warning see selections made by $N startup blocks or earlier
// external sessions, not just this app's own console commands.

import type { ControllerEvent } from '../../core/controllers';
import { activeWcsFromModalBody } from '../../core/controllers/grbl/work-offset-readback';
import type { SetFn } from './laser-line-shared';

/** Stores the WCS a modal report names. Non-modal lines and ambiguous
 * reports (none or several G54-G59 words) change nothing. */
export function observeActiveWcsReport(set: SetFn, cls: ControllerEvent): void {
  if (cls.kind !== 'message' || cls.tag !== 'GC') return;
  const activeWcs = activeWcsFromModalBody(cls.body);
  if (activeWcs !== null) set({ activeWcs });
}
