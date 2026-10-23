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

import {
  commonConsoleStateEffect,
  scanConsoleWords,
  type ConsoleStateEffect,
} from '../../core/controllers/console-state-effect';
import type { ActiveWorkCoordinateSystem } from '../../core/controllers/grbl/work-offset-readback';
import type { GcodeWordMatch } from '../../core/gcode/word-scan';
import { wcsSelectedByLine } from './acknowledged-wcs';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';

/** The Console effects that void Work Z (laser-console-actions.ts). */
const WORK_Z_EFFECTS: ReadonlySet<ConsoleStateEffect> = new Set([
  'coordinates-z',
  'coordinates-all',
  'tool',
]);

export type ExternalProgramControllerEffects = {
  /** A G54-G59 word selects a system other than `activeWcs`. */
  readonly selectsOtherWcs: boolean;
  /** A line changes a Z offset or the tool, by the Console's rule. */
  readonly changesWorkZ: boolean;
};

/** What `gcode` may change, read against the system the store knows is active
 *  (null when it does not know). */
export function externalProgramControllerEffects(
  gcode: string,
  activeWcs: ActiveWorkCoordinateSystem | null,
): ExternalProgramControllerEffects {
  let selectsOtherWcs = false;
  let changesWorkZ = false;
  for (const line of gcode.split('\n')) {
    const words = scanConsoleWords(line);
    if (!words.some(mayChangeControllerState)) continue;
    const selected = wcsSelectedByLine(line);
    if (selected !== undefined && selected !== activeWcs) selectsOtherWcs = true;
    const effect = commonConsoleStateEffect(withoutActiveWcs(words, activeWcs));
    if (WORK_Z_EFFECTS.has(effect)) changesWorkZ = true;
    if (selectsOtherWcs && changesWorkZ) break;
  }
  return { selectsOtherWcs, changesWorkZ };
}

/** The store as an opened program starts streaming. */
export function externalProgramControllerStatePatch(
  state: LaserState,
  gcode: string,
): Partial<LaserState> {
  const effects = externalProgramControllerEffects(gcode, state.activeWcs);
  const dropsWcs = effects.selectsOtherWcs && state.activeWcs !== null;
  if (!dropsWcs && !effects.changesWorkZ) return {};
  const notes = [
    ...(dropsWcs
      ? [
          `it selects a work coordinate system other than ${state.activeWcs}, so the next Frame reads the active one first`,
        ]
      : []),
    ...(effects.changesWorkZ
      ? ['it changes a Z offset or the tool, so Work Z set before it no longer applies']
      : []),
  ];
  return {
    ...(dropsWcs ? { activeWcs: null } : {}),
    ...(effects.changesWorkZ
      ? { workZZeroEvidence: null, workZReferenceEpoch: state.workZReferenceEpoch + 1 }
      : {}),
    log: pushLog(state, `[lf2] Opened program: ${notes.join('; ')}.`),
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
