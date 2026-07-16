// detectActiveWcsMismatchWarnings — advisory (C6): KerfDesk pins G54 in every
// emitted job and origin command, but a placement computed from Current
// Position / User Origin reads the ACTIVE work offset the controller reports.
// If the operator has selected G55-G59 (via the console), that offset belongs
// to a different frame than the G54 the job runs in, so the job can execute at
// the wrong physical position. Warn rather than block: reselecting G54 clears
// it, and blocking a valid multi-WCS workflow would be an unapproved guard.
//
// Scope: only the operator's console selection is tracked. A $N startup block
// or an external session that leaves G55-G59 active is not detected here (that
// needs an owned $G parser-state readback at connect).

import type { ActiveWorkCoordinateSystem } from '../../core/controllers/grbl/work-offset-readback';

const EMITTED_WCS: ActiveWorkCoordinateSystem = 'G54';

export function detectActiveWcsMismatchWarnings(
  activeWcs: ActiveWorkCoordinateSystem | null,
): ReadonlyArray<string> {
  if (activeWcs === null || activeWcs === EMITTED_WCS) return [];
  return [
    `The controller has ${activeWcs} selected, but KerfDesk emits ${EMITTED_WCS}. Placement is ` +
      `measured from the active ${activeWcs} work offset while the job runs in ${EMITTED_WCS}, so ` +
      `it can cut in the wrong place. Send "${EMITTED_WCS}" to reselect it before Start, or set ` +
      `${EMITTED_WCS} and ${activeWcs} to the same offset.`,
  ];
}
