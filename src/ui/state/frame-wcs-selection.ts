// The Frame's own work-coordinate-system selection (controller audit 2026-09-25
// CG-2). The prepared program runs in G54, so a Frame that must match it selects
// G54 first. Before this, an unknown WCS was treated as a change: G54 was
// written blind and the operator's G92 origin record, offset and work Z were
// dropped with it, so the next Frame refused its placement or placed a Current
// Position job displaced by the G92 offset. Now:
//   - KerfDesk selects G54 only where it can read the active WCS back (`$G`).
//     Marlin has no such query, and its program carries no G54
//     (marlin-inline-transform.ts); stock Marlin has no G54-G59 at all.
//   - An unknown WCS is read first; G54 is written only when another is active.
//   - A selection keeps the XY origin record: G92 is independent of G54-G59 on
//     GRBL, grblHAL, FluidNC and Smoothieware. A change of WCS makes GRBL-family
//     firmware put the new offset in its next report (gnea/grbl gcode.c:995-999;
//     grblHAL gcode.c:4483-4487), and the Frame waits for that report.

import type { ActiveWorkCoordinateSystem } from '../../core/controllers/grbl/work-offset-readback';
import type { ControllerDriver } from '../../core/controllers';
import type { ControllerLifecycleRefs } from './laser-interactive-command';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';
import type { TranscriptSource } from './laser-transcript';
import { requestTerminalOwnedActiveWcsReadback } from './terminal-owned-wcs-readback';

export type FrameWcsSelection =
  /** G54 is active (known, or read back just now). */
  | { readonly kind: 'already-g54' }
  /** The controller has no WCS KerfDesk can read or select (Marlin). */
  | { readonly kind: 'not-selectable' }
  /** G54 was written; `previous` is the WCS it replaced when known. */
  | { readonly kind: 'selected'; readonly previous: ActiveWorkCoordinateSystem | null };

type WriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

/** True where KerfDesk can read the active WCS back, and so may select G54. */
export function canSelectFrameWcs(driver: Pick<ControllerDriver, 'commands'>): boolean {
  return driver.commands.modalStateQuery !== null;
}

/** Reads the active WCS when the store does not know it. Non-fatal. */
export async function readUnknownActiveWcs(
  get: () => LaserState,
  refs: ControllerLifecycleRefs & { readonly driver: ControllerDriver },
  write: WriteFn,
): Promise<void> {
  if (get().activeWcs !== null) return;
  await requestTerminalOwnedActiveWcsReadback(
    get,
    refs,
    write,
    get().controllerSessionEpoch,
    'interactive-command',
  );
}

/** After an acknowledged Console command. A G54-G59 word is the WCS the
 *  operator left active, which save and Start advisories compare with the G54
 *  that emission pins (audit C6). A `$H` runs the controller's startup lines,
 *  which can select another WCS, so the WCS is read again (audit GP-1). */
export async function trackConsoleWcs(
  set: (partial: Partial<LaserState>) => void,
  get: () => LaserState,
  refs: ControllerLifecycleRefs & { readonly driver: ControllerDriver },
  command: { readonly normalized: string; readonly stateEffect: string },
  write: WriteFn,
): Promise<void> {
  const selection = consoleWcsSelection(command.normalized);
  if (selection !== null) set({ activeWcs: selection });
  if (command.stateEffect !== 'reference') return;
  set({ activeWcs: null });
  await readUnknownActiveWcs(get, refs, write);
}

// The last G54-G59 word in a console command is the WCS it leaves active. GRBL
// status never reports which WCS is active, so this console echo is how the app
// learns the operator selected a non-G54 frame.
function consoleWcsSelection(normalized: string): ActiveWorkCoordinateSystem | null {
  const matches = normalized.toUpperCase().match(/\bG5[4-9]\b/g);
  const last = matches?.at(-1);
  return last === undefined ? null : (last as ActiveWorkCoordinateSystem);
}

/** The state after the Frame's G54 was acknowledged. */
export function frameWcsSelectionPatch(
  state: LaserState,
  previous: ActiveWorkCoordinateSystem | null,
): Partial<LaserState> {
  return {
    // The next report must show the controller in G54.
    statusReport: null,
    statusObservation: null,
    frameVerification: null,
    framedRun: null,
    frameTrace: null,
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    // A known change voids the offset; the controller reports the new one. An
    // unknown previous WCS keeps it: if G54 changed the offset, the report the
    // Frame waits for carries the new one.
    ...(previous === null ? {} : { wcoCache: null }),
    // Work Z can differ between work systems.
    workZZeroEvidence: null,
    workZReferenceEpoch: state.workZReferenceEpoch + 1,
    activeWcs: 'G54',
    log: pushLog(
      state,
      `[lf2] Frame selected G54${previous === null ? '' : ` (was ${previous})`}; the work origin record is kept.`,
    ),
  };
}
