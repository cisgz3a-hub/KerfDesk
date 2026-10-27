// external-program-controller-state — the store records an opened program's
// own words may change, dropped as its stream is installed (controller audit v4
// E4-P1-1 and E4-P2-1, ADR-630 Amendment 6).
//
// KerfDesk's own programs pin G54 and write no offset or tool. An opened
// program can do both, and the store kept what it knew before the run:
// - A program that selects G55-G59 with no M2/M30 after it leaves the
//   controller there: only a program end selects G54 again (gnea/grbl gcode.c
//   L1091-1101; FluidNC v4.0.3 the same), and Smoothieware outside grbl_mode
//   keeps the system even through M30. The store still said G54, so the next
//   Frame skipped its G54 selection (frame-controller-readiness.ts) and traced
//   in G55, while the job's own G54 cut at the G54 origin.
// - `G92 X/Y` or `G10 L2/L20 X/Y` left the X/Y work origin KerfDesk set
//   marked current; the Console already drops it for the same words.
// - `G92 Z`, `G10 L2/L20 Z`, `G43.1`, `M6` or `T` left the probed Work Z
//   current, so the next CNC Start skipped its Zero Z check. GRBL keeps G92 and
//   the tool length offset through M30, and G10 writes them to EEPROM. So do
//   grblHAL's tool-table `G43`/`G43.2 H` and `M61`, whose offset also outlasts a
//   soft reset (ADR-630 Amendment 8).
// The Console drops the same evidence for the same words, and each line is read
// with its rule (commonConsoleStateEffect). A word that selects the system
// already active changes nothing, so a CAM header's `G54` keeps both records.
// They go before the first line is sent: a Stop after a G10 cannot undo what the
// controller stored, and a completed run keeps the rest. An unknown system is
// read with `$G` before the next Frame selects G54 (frame-wcs-selection.ts,
// audit CG-2).

import type { ControllerDriver } from '../../core/controllers';
import {
  commonConsoleStateEffect,
  scanConsoleWords,
  type ConsoleStateEffect,
} from '../../core/controllers/console-state-effect';
import type { ActiveWorkCoordinateSystem } from '../../core/controllers/grbl/work-offset-readback';
import type { GcodeWordMatch } from '../../core/gcode/word-scan';
import { wcsSelectedByLine } from './acknowledged-wcs';
import { lineLeavesOtherReportUnits } from './console-report-units';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';

/** The Console effects that void Work Z (laser-console-actions.ts). */
const WORK_Z_EFFECTS: ReadonlySet<ConsoleStateEffect> = new Set([
  'coordinates-z',
  'coordinates-all',
  'tool',
]);

/** The Console effects that void the X/Y work origin (laser-console-actions.ts). */
const WORK_ORIGIN_EFFECTS: ReadonlySet<ConsoleStateEffect> = new Set([
  'coordinates-xy',
  'coordinates-all',
]);

export type ExternalProgramControllerEffects = {
  /** A G54-G59 word selects a system other than `activeWcs`. */
  readonly selectsOtherWcs: boolean;
  /** A line changes a Z offset or the tool, by the Console's rule. */
  readonly changesWorkZ: boolean;
  /** A line changes an X/Y offset (`G92 X`, `G10 L2/L20 X`), by the Console's rule. */
  readonly changesWorkOrigin: boolean;
};

/** What `gcode` may change, read against the system the store knows is active
 *  (null when it does not know). */
export function externalProgramControllerEffects(
  gcode: string,
  activeWcs: ActiveWorkCoordinateSystem | null,
): ExternalProgramControllerEffects {
  let selectsOtherWcs = false;
  let changesWorkZ = false;
  let changesWorkOrigin = false;
  for (const line of gcode.split('\n')) {
    const words = scanConsoleWords(line);
    if (!words.some(mayChangeControllerState)) continue;
    const selected = wcsSelectedByLine(line);
    if (selected !== undefined && selected !== activeWcs) selectsOtherWcs = true;
    const effect = commonConsoleStateEffect(withoutActiveWcs(words, activeWcs));
    if (WORK_Z_EFFECTS.has(effect)) changesWorkZ = true;
    if (WORK_ORIGIN_EFFECTS.has(effect)) changesWorkOrigin = true;
    if (selectsOtherWcs && changesWorkZ && changesWorkOrigin) break;
  }
  return { selectsOtherWcs, changesWorkZ, changesWorkOrigin };
}

/** The store as an opened program starts streaming. */
export function externalProgramControllerStatePatch(
  state: LaserState,
  gcode: string,
  driver?: Pick<ControllerDriver, 'reportUnitsSelectedBy'>,
): Partial<LaserState> {
  const effects = externalProgramControllerEffects(gcode, state.activeWcs);
  const parts = [
    wcsPart(state, effects),
    workZPart(state, effects),
    workOriginPart(state, effects),
    reportUnitsPart(state, gcode, driver),
  ];
  const notes = parts.flatMap((part) => (part.note === null ? [] : [part.note]));
  const patch: Partial<LaserState> = Object.assign({}, ...parts.map((part) => part.patch));
  if (Object.keys(patch).length === 0) return {};
  return notes.length === 0
    ? patch
    : { ...patch, log: pushLog(state, `[lf2] Opened program: ${notes.join('; ')}.`) };
}

type StatePart = { readonly patch: Partial<LaserState>; readonly note: string | null };

const NO_PART: StatePart = { patch: {}, note: null };

function wcsPart(state: LaserState, effects: ExternalProgramControllerEffects): StatePart {
  if (!effects.selectsOtherWcs || state.activeWcs === null) return NO_PART;
  return {
    patch: { activeWcs: null },
    note: `it selects a work coordinate system other than ${state.activeWcs}, so the next Frame reads the active one first`,
  };
}

function workZPart(state: LaserState, effects: ExternalProgramControllerEffects): StatePart {
  if (!effects.changesWorkZ) return NO_PART;
  return {
    patch: { workZZeroEvidence: null, workZReferenceEpoch: state.workZReferenceEpoch + 1 },
    note: 'it changes a Z offset or the tool, so Work Z set before it no longer applies',
  };
}

// As the Console's coordinates-xy effect: the origin KerfDesk set is gone, and
// the next status report brings the new offset. Anything bound to the old
// origin, such as a Place Board registration, does not outlive it.
function workOriginPart(state: LaserState, effects: ExternalProgramControllerEffects): StatePart {
  if (!effects.changesWorkOrigin) return NO_PART;
  const workOriginVersion = (state.workOriginVersion ?? 0) + 1;
  if (!state.workOriginActive) return { patch: { workOriginVersion }, note: null };
  return {
    patch: { workOriginVersion, workOriginActive: false, workOriginSource: 'none', wcoCache: null },
    note: 'it changes an X/Y offset, so the work origin set before it no longer applies',
  };
}

// Smoothieware reports positions in the units the program selects and keeps
// G20 through M2 and M30 (Robot.cpp L726-L734), so a program that may leave
// other units than KerfDesk reads in hides the reported position until `$G`
// or the next Frame names them, as a Console G20 does (console-report-units.ts,
// rolling audit v3 G4-P1-2). A CAM header's G21 changes nothing.
// https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/robot/Robot.cpp#L726-L734
function reportUnitsPart(
  state: LaserState,
  gcode: string,
  driver: Pick<ControllerDriver, 'reportUnitsSelectedBy'> | undefined,
): StatePart {
  if (driver?.reportUnitsSelectedBy === undefined) return NO_PART;
  // Most programs name no units at all; one pass over the text says so.
  if (driver.reportUnitsSelectedBy(gcode) === null) return NO_PART;
  const lines = gcode.split('\n');
  if (!lines.some((line) => lineLeavesOtherReportUnits(driver, line, state))) return NO_PART;
  return {
    patch: { reportUnitsUnconfirmed: true, wcoCache: null },
    note: 'it may change the units the controller reports positions in, so the machine position stays hidden until $G or the next Frame names them',
  };
}

// Motion lines are most of a program. Only a G word other than G0-G3, or an M
// or T word, can carry a word the Console's rule looks for.
function mayChangeControllerState({ letter, value }: GcodeWordMatch): boolean {
  if (letter === 'M' || letter === 'T') return true;
  return letter === 'G' && !(Number.isInteger(value) && value >= 0 && value <= 3);
}

// Selecting the system already active changes no offset. A line's other words
// keep their meaning.
function withoutActiveWcs(
  words: ReadonlyArray<GcodeWordMatch>,
  activeWcs: ActiveWorkCoordinateSystem | null,
): string {
  const active = activeWcs === null ? null : Number(activeWcs.slice(1));
  return words
    .filter(({ letter, value }) => !(letter === 'G' && value === active))
    .map(({ letter, value }) => `${letter}${value}`)
    .join(' ');
}
