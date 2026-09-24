// Laser start-from-line recovery (ADR-103 G7, ADR-141): scan the program's
// modal state up to the chosen line, then position with the beam off before
// replaying the remaining geometry with power restored only on burn motion.
// Automatic CNC recovery is refused:
// controller acknowledgements cannot establish physical execution or cutter
// clearance after an interruption.

import {
  rewriteLaserResumeTail,
  type LaserResumeModalState,
  type LaserResumeMotion,
  type LaserResumeTransformVersion,
} from './laser-resume-reentry';
import type { LaserResumeDialect } from './laser-resume-dialect';
import { createNativeLaserBeam, type NativeLaserBeam } from './native-laser-resume-beam';
import { nativeLaserResume, scanNativeBeamLine } from './native-laser-resume';

export type { LaserResumeTransformVersion };
/** The transform new resumes use; archived resume steps record their own. */
export const LASER_RESUME_TRANSFORM_VERSION: LaserResumeTransformVersion = 3;

export type ResumeProgram = {
  readonly kind: 'ok';
  readonly lines: ReadonlyArray<string>;
  /** 1-based line number of the first replayed original line. */
  readonly fromLine: number;
  readonly preambleCount: number;
};

export type ResumeProgramError = {
  readonly kind: 'error';
  readonly reason: string;
};

export type ResumeProgramResult = ResumeProgram | ResumeProgramError;

export const CNC_AUTOMATIC_RECOVERY_DISABLED_REASON =
  'Automatic CNC restart from a checkpoint or G-code line is disabled because controller ' +
  'acknowledgements do not prove which cuts physically completed or whether the cutter is ' +
  'clear. Inspect the machine and determine cutter engagement. Under supervision, establish ' +
  'clearance using the machine-specific recovery procedure; re-home if position may be lost; ' +
  'then verify the work coordinate system (WCS), Z zero, tool, workholding, and a newly reviewed ' +
  'recovery job before starting.';

export type ResumeOptions = {
  readonly machineKind: 'laser' | 'cnc';
  // Retained in the public options shape for compatibility with existing
  // callers. CNC recovery never consumes these values because it is refused.
  readonly safeZMm: number;
  readonly spindleSpinupSec: number;
  readonly plungeMmPerMin: number;
  /** Laser transform to reproduce; the current one unless replaying an archive. */
  readonly laserTransform?: LaserResumeTransformVersion;
  /** The power commands of the controller the program was written for
   * (laserResumeDialectForDevice). Transform 3 rebuilds the beam in them;
   * transforms 1 and 2 always wrote GRBL's, and so replay their archives. */
  readonly laserDialect?: LaserResumeDialect;
};

type GcodeWord = { readonly letter: string; readonly value: number };

const WORD_RE = /([A-Za-z])(-?\d+(?:\.\d+)?)/g;

export function buildResumeProgram(
  gcode: string,
  fromLine: number,
  options: ResumeOptions,
): ResumeProgramResult {
  if (options.machineKind === 'cnc') {
    return { kind: 'error', reason: CNC_AUTOMATIC_RECOVERY_DISABLED_REASON };
  }

  const lines = gcode.split('\n');
  if (!Number.isInteger(fromLine) || fromLine < 1 || fromLine > lines.length) {
    return { kind: 'error', reason: `Line must be between 1 and ${lines.length}.` };
  }
  const transform = options.laserTransform ?? LASER_RESUME_TRANSFORM_VERSION;
  const state: LaserResumeModalState = {
    units: 'G21',
    spindle: 'M5',
    motion: null,
    wcs: 'G54',
    sValue: null,
    feed: null,
    x: null,
    y: null,
    mist: false,
    flood: false,
  };
  const beam = nativeBeamFor(transform, options.laserDialect);
  const issue = scanToResumeLine(lines, fromLine, state, beam);
  if (issue !== null) return { kind: 'error', reason: issue };
  const originalTail = lines.slice(fromLine - 1);
  if (originalTail.every((line) => stripComments(line).trim() === '')) {
    return { kind: 'error', reason: 'Nothing left to run from that line.' };
  }
  const { preamble, tail } = resumeBody(state, beam, originalTail, transform);
  return {
    kind: 'ok',
    lines: [...preamble, ...tail],
    fromLine,
    preambleCount: preamble.length,
  };
}

// Smoothieware and Marlin programs get their own power commands from
// transform 3 on (ADR-364). Earlier transforms wrote GRBL's for every program,
// and their archived steps must still rebuild those exact bytes.
function nativeBeamFor(
  transform: LaserResumeTransformVersion,
  dialect: LaserResumeDialect | undefined,
): NativeLaserBeam | null {
  if (transform < 3 || dialect === undefined || dialect === 'grbl') return null;
  return createNativeLaserBeam(dialect);
}

/** Follows the program up to the resume line, or says why the replay cannot. */
function scanToResumeLine(
  lines: ReadonlyArray<string>,
  fromLine: number,
  state: LaserResumeModalState,
  beam: NativeLaserBeam | null,
): string | null {
  for (let i = 0; i < fromLine - 1; i += 1) {
    const line = lines[i] ?? '';
    const issue = applyLine(state, line);
    if (issue !== null) return `Line ${i + 1}: ${issue}`;
    if (beam !== null) scanNativeBeamLine(beam, line);
  }
  return null;
}

function resumeBody(
  state: LaserResumeModalState,
  beam: NativeLaserBeam | null,
  originalTail: ReadonlyArray<string>,
  transform: LaserResumeTransformVersion,
): { readonly preamble: ReadonlyArray<string>; readonly tail: ReadonlyArray<string> } {
  if (beam !== null) return nativeLaserResume(state, beam, originalTail);
  return {
    preamble: buildPreamble(state, transform),
    tail: rewriteLaserResumeTail(state, originalTail, transform),
  };
}

// Returns an error string for constructs the replay cannot handle.
function applyLine(state: LaserResumeModalState, rawLine: string): string | null {
  const line = stripComments(rawLine);
  if (line.trim() === '' || line.trim() === '%') return null;
  const words: GcodeWord[] = [...line.matchAll(WORD_RE)].map((match) => ({
    letter: (match[1] ?? '').toUpperCase(),
    value: Number(match[2]),
  }));
  for (const { letter, value } of words) {
    const issue = applyWord(state, letter, value);
    if (issue !== null) return issue;
  }
  return null;
}

function applyWord(state: LaserResumeModalState, letter: string, value: number): string | null {
  if (letter === 'G') return applyGWord(state, value);
  if (letter === 'M') {
    applyMWord(state, value);
    return null;
  }
  if (letter === 'S') state.sValue = value;
  if (letter === 'F') state.feed = value;
  if (letter === 'X') state.x = value;
  if (letter === 'Y') state.y = value;
  return null;
}

function applyGWord(state: LaserResumeModalState, value: number): string | null {
  const refusal = unsupportedGWordReason(value);
  if (refusal !== null) return refusal;
  applyModalGWord(state, value);
  return null;
}

// G-words the beam-off replay cannot reconstruct. Machine-coordinate and
// predefined-position moves change the position without updating the tracked
// X/Y modal words, so the re-entry would target the wrong point. KerfDesk's own
// emitters never produce them; imported external G-code can (audit F11).
function unsupportedGWordReason(value: number): string | null {
  if (value === 91) return 'relative positioning (G91) — resume needs absolute programs';
  if (value === 53) return 'machine-coordinate motion (G53) — resume tracks work coordinates only';
  if (value === 28 || value === 30) {
    return `predefined-position move (G${value}) — resume cannot track its endpoint`;
  }
  return null;
}

function applyModalGWord(state: LaserResumeModalState, value: number): void {
  if (value === 20) state.units = 'G20';
  else if (value === 21) state.units = 'G21';
  else if (value >= 54 && value <= 59 && Number.isInteger(value)) {
    state.wcs = `G${value}` as LaserResumeModalState['wcs'];
  }
  const motion = motionForGWord(value);
  if (motion !== null) state.motion = motion;
}

function motionForGWord(value: number): LaserResumeMotion {
  if (value === 0) return 'G0';
  if (value === 1) return 'G1';
  if (value === 2) return 'G2';
  if (value === 3) return 'G3';
  return null;
}

function applyMWord(state: LaserResumeModalState, value: number): void {
  if (value === 3) state.spindle = 'M3';
  if (value === 4) state.spindle = 'M4';
  if (value === 5) state.spindle = 'M5';
  // Coolant outputs drive laser air assist: M7 mist, M8 flood, M9 both off.
  if (value === 7) state.mist = true;
  if (value === 8) state.flood = true;
  if (value === 9) {
    state.mist = false;
    state.flood = false;
  }
}

function buildPreamble(
  state: LaserResumeModalState,
  transform: LaserResumeTransformVersion,
): ReadonlyArray<string> {
  // Pin the WCS and feed mode before re-positioning, exactly as the job preamble
  // does (grbl-strategy.ts): a resume re-executes from a mid-program line, and a
  // stale modal G55-G59 would send the re-entry move — and the rest of the job —
  // to the wrong frame, while a stale G93 would misread every feed (F10/F41/F50).
  // Re-select the WCS the program actually had active (G54 for KerfDesk's own
  // jobs; the program's own G55-G59 for imported programs — C8) rather than
  // hard-pinning G54, which would reframe a G55 program's whole tail.
  return [
    '; KerfDesk resume preamble',
    state.units,
    'G90',
    state.wcs,
    'G94',
    ...laserResumeBody(state, transform),
  ];
}

// Laser re-entry: hard-off first, position with explicit S0, then re-arm at S0.
// Replay restores positive power only on actual burn motion. No spin-up dwell:
// a G4 with M3 active fires the stationary beam. No Z words: laser jobs must
// never command the Z axis on resume. Transform 2 also re-issues the air assist
// the interrupted program had switched on (M7/M8 are coolant outputs, and a
// controller reset turns them off), before the re-entry move so the air is
// flowing when the beam first fires (ADR-341 Amendment 3).
function laserResumeBody(
  state: LaserResumeModalState,
  transform: LaserResumeTransformVersion,
): string[] {
  const lines = ['M5'];
  if (transform >= 2) lines.push(...airWords(state));
  const move = positionMove(state);
  if (move !== null) lines.push(move);
  if (state.spindle !== 'M5') lines.push(`${state.spindle} S0`);
  if (state.feed !== null) lines.push(`F${formatNumber(state.feed)}`);
  return lines;
}

function airWords(state: LaserResumeModalState): string[] {
  const words: string[] = [];
  if (state.mist) words.push('M7');
  if (state.flood) words.push('M8');
  return words;
}

function positionMove(state: LaserResumeModalState): string | null {
  if (state.x === null && state.y === null) return null;
  const x = state.x === null ? '' : ` X${formatNumber(state.x)}`;
  const y = state.y === null ? '' : ` Y${formatNumber(state.y)}`;
  return `G0${x}${y} S0`;
}

function stripComments(line: string): string {
  return line.replace(/\(.*?\)/g, '').replace(/;.*$/, '');
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
