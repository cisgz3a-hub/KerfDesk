// acknowledged-wcs — the store's active work coordinate system follows a
// G54-G59 word KerfDesk sends itself, once the controller acknowledges it
// (controller audit v2 C2-P2-1, ADR-375 Amendment 3).
//
// Every probe cycle starts with `G54`, and on GRBL-family controllers Zero Z,
// Set origin and the saved-origin writes put `G54` in the block with their G92
// or G10. A G54-G59 word is a persistent modal change in GRBL, and `G10 L20 P0`
// writes whichever system is then active. The store used to keep the system it
// knew before, so after a probe on a controller left in G55 the next Frame
// "selected" G54 again, voided the fresh probe Work-Z and asked for Zero Z with
// the bit parked above the stock.
//
// A known change of system changes the work offset on every axis, so what was
// measured in the old one is void, as after the Frame's own selection
// (frame-wcs-selection.ts). Work-Z evidence is cleared without a new epoch:
// Zero Z captures its evidence before its `G54 G92 Z0` and records it after,
// and that zero is taken in the new system. When the previous system was not
// known, the offset is kept: GRBL-family firmware reports the new offset in its
// next status report after a change of system (gnea/grbl gcode.c:995-999;
// grblHAL gcode.c:4483-4487).

import type { ActiveWorkCoordinateSystem } from '../../core/controllers/grbl/work-offset-readback';
import { scanConsoleWords } from '../../core/controllers/console-state-effect';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';

/** The system the last G54-G59 word in `line` selects: undefined when the line
 *  selects none, null for an extended spelling (G59.1) whose meaning depends
 *  on the dialect. */
export function wcsSelectedByLine(line: string): ActiveWorkCoordinateSystem | null | undefined {
  const selections = scanConsoleWords(line.toUpperCase()).filter(
    ({ letter, value }) => letter === 'G' && value >= 54 && value < 60,
  );
  const last = selections.at(-1);
  if (last === undefined) return undefined;
  return Number.isInteger(last.value) ? (`G${last.value}` as ActiveWorkCoordinateSystem) : null;
}

/** The store after the controller acknowledged `line`, a line KerfDesk sent
 *  for `label`. */
export function acknowledgedWcsPatch(
  state: LaserState,
  line: string,
  label: string,
): Partial<LaserState> {
  const selected = wcsSelectedByLine(line);
  if (selected === undefined || selected === state.activeWcs) return {};
  const previous = state.activeWcs;
  if (previous === null || selected === null) return { activeWcs: selected };
  return {
    activeWcs: selected,
    wcoCache: null,
    frameVerification: null,
    framedRun: null,
    frameTrace: null,
    workZZeroEvidence: null,
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    log: pushLog(
      state,
      `[lf2] ${label} selected ${selected} (was ${previous}); positions and Work Z measured in ${previous} no longer apply.`,
    ),
  };
}
