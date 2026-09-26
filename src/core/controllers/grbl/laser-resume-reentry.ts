/** Motion mode known at the laser recovery boundary. */
export type LaserResumeMotion = 'G0' | 'G1' | 'G2' | 'G3' | null;

/** Active work coordinate system at the recovery boundary. */
export type LaserResumeWcs = 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59';

/**
 * The laser resume transform, recorded with every archived resume step so a
 * saved recovery replays with the transform that produced its bytes
 * (ADR-341 Amendment 3).
 *
 * 1: the original transform. Its re-entry `G0` left the modal motion at rapid,
 *    so a raster row resumed mid-row ran dark, and air assist stayed off.
 * 2: re-issues the active air assist before the re-entry and makes the first
 *    resumed movement state its motion mode explicitly.
 * 3: rebuilds the beam in the power commands of the controller the program was
 *    written for: Smoothieware `M221`, Marlin `M3 I` and Marlin `M106`
 *    (ADR-364). Transforms 1 and 2 always wrote GRBL's, which left those
 *    programs dark. A GRBL-family program resumes exactly as in transform 2.
 * 4: re-selects the arc plane (G17/G18/G19) the program had active, or G17
 *    when the replayed tail holds G2/G3 and the program named none (ADR-432):
 *    a plane left changed by a console command or `$N` startup block would
 *    otherwise run an XY I/J arc in the wrong plane. A program with neither a
 *    plane word nor an arc resumes exactly as in transform 3.
 */
export type LaserResumeTransformVersion = 1 | 2 | 3 | 4;

/** True for a transform this build can replay. */
export function isLaserResumeTransformVersion(
  value: unknown,
): value is LaserResumeTransformVersion {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/** Modal values needed to rebuild a beam-off laser recovery boundary. */
export type LaserResumeModalState = {
  units: 'G20' | 'G21';
  spindle: 'M3' | 'M4' | 'M5';
  motion: LaserResumeMotion;
  // The program's active WCS at the resume line. KerfDesk's own jobs always run
  // in G54, but an imported program may select G55-G59; the resume preamble must
  // re-select whatever was active or the replayed tail runs in the wrong frame.
  wcs: LaserResumeWcs;
  /** The arc plane the program last selected, if it named one. */
  plane: 'G17' | 'G18' | 'G19' | null;
  sValue: number | null;
  feed: number | null;
  x: number | null;
  y: number | null;
  // Air assist rides the coolant outputs: M7 (mist) and M8 (flood), M9 off.
  mist: boolean;
  flood: boolean;
};

/** One address word of a line, with its number as the line spells it. */
export type GcodeWord = { readonly letter: string; readonly value: number; readonly text: string };
type RewrittenLine = { readonly line: string; readonly physicalPower: number };

const WORD_RE = /([A-Za-z])(-?\d+(?:\.\d+)?)/g;
const POWER_OR_COMMENT_RE = /(\([^)]*\))|[Ss]-?\d+(?:\.\d+)?/g;
const AXIS_LETTERS: ReadonlySet<string> = new Set(['X', 'Y', 'Z', 'A', 'B', 'C']);
// Group-0 commands that consume a line's axis words themselves, so the modal
// motion mode does not run (GRBL gcode.c AXIS_COMMAND_NON_MODAL; G43.1 is the
// tool-length axis command).
const AXIS_CONSUMING_G: ReadonlySet<number> = new Set([10, 28, 30, 92, 43.1]);
const EXPLICIT_MOTION_G: ReadonlySet<number> = new Set([0, 1, 2, 3, 38.2, 38.3, 38.4, 38.5, 80]);

/** Keeps replay power at zero until the source program reaches real burn motion. */
export function rewriteLaserResumeTail(
  state: LaserResumeModalState,
  originalTail: ReadonlyArray<string>,
  version: LaserResumeTransformVersion = 1,
): ReadonlyArray<string> {
  const intended = { ...state };
  const rewritten: string[] = [];
  let physicalPower = 0;
  // The re-entry move is a G0, so the controller's modal motion is rapid
  // until the program next names a motion word. Transform 2 names the
  // program's own motion mode on the first line that relies on it.
  let motionPending = version >= 2;
  for (const rawLine of originalTail) {
    let line = rawLine;
    if (motionPending) {
      const restored = restoreModalMotion(intended, rawLine);
      line = restored.line;
      motionPending = !restored.settled;
    }
    const result = rewriteReplayLine(intended, line, physicalPower, version);
    rewritten.push(result.line);
    physicalPower = result.physicalPower;
  }
  return rewritten;
}

/** Names the intended motion mode on the first line that would otherwise run
 * the controller's modal motion (still G0 from the re-entry). A line with its
 * own motion word settles the controller's motion mode by itself. */
export function restoreModalMotion(
  intended: LaserResumeModalState,
  rawLine: string,
): { readonly line: string; readonly settled: boolean } {
  const words = wordsForLine(rawLine);
  if (words.some(isExplicitMotionWord)) return { line: rawLine, settled: true };
  if (!invokesModalMotion(words)) return { line: rawLine, settled: false };
  if (intended.motion === null) return { line: rawLine, settled: true };
  return { line: withMotionWord(rawLine, intended.motion), settled: true };
}

function isExplicitMotionWord({ letter, value }: GcodeWord): boolean {
  return letter === 'G' && EXPLICIT_MOTION_G.has(value);
}

/** GRBL runs the modal motion mode for any line with axis words and no
 * explicit axis command, whatever other modal G words (G90, G21...) it has. */
export function invokesModalMotion(words: ReadonlyArray<GcodeWord>): boolean {
  const hasAxisWord = words.some(({ letter }) => AXIS_LETTERS.has(letter));
  if (!hasAxisWord) return false;
  return !words.some(
    (word) =>
      isExplicitMotionWord(word) || (word.letter === 'G' && AXIS_CONSUMING_G.has(word.value)),
  );
}

/** Inserts the motion word at the start of the line's words, after any leading
 * whitespace and `N` line number, in the line's own spacing style. */
function withMotionWord(rawLine: string, motion: Exclude<LaserResumeMotion, null>): string {
  const lead = /^\s*(?:[Nn]\d+\s*)?/.exec(rawLine)?.[0] ?? '';
  const separator = /\s/.test(stripComments(rawLine).trim()) ? ' ' : '';
  return `${lead}${motion}${separator}${rawLine.slice(lead.length)}`;
}

function rewriteReplayLine(
  intended: LaserResumeModalState,
  rawLine: string,
  physicalPower: number,
  version: LaserResumeTransformVersion,
): RewrittenLine {
  const words = wordsForLine(rawLine);
  applyReplayWords(intended, words);
  const explicitPower = lastWordValue(words, 'S');
  const hasArm = words.some(({ letter, value }) => letter === 'M' && (value === 3 || value === 4));
  if (isBurnMotion(intended, words, version)) {
    const burnPower = intended.sValue ?? 0;
    const line =
      explicitPower === null && physicalPower !== burnPower
        ? withPowerWord(rawLine, burnPower)
        : rawLine;
    return { line, physicalPower: burnPower };
  }
  let line = rawLine;
  let nextPower = explicitPower ?? physicalPower;
  if (explicitPower !== null && explicitPower > 0) {
    line = withPowerWord(line, 0);
    nextPower = 0;
  }
  if (hasArm) {
    line = withPowerWord(line, 0);
    nextPower = 0;
  }
  return { line, physicalPower: nextPower };
}

function applyReplayWords(state: LaserResumeModalState, words: ReadonlyArray<GcodeWord>): void {
  for (const { letter, value } of words) {
    const motion = letter === 'G' ? motionFor(value) : null;
    const spindle = letter === 'M' ? spindleFor(value) : null;
    if (motion !== null) state.motion = motion;
    if (spindle !== null) state.spindle = spindle;
    if (letter === 'S') state.sValue = value;
  }
}

function isBurnMotion(
  state: LaserResumeModalState,
  words: ReadonlyArray<GcodeWord>,
  version: LaserResumeTransformVersion,
): boolean {
  return (
    state.spindle !== 'M5' &&
    state.sValue !== null &&
    state.sValue > 0 &&
    movesInBurnMotion(state, words, version)
  );
}

/** The line moves the head in G1, G2 or G3: the moves a laser burns on. */
export function movesInBurnMotion(
  state: LaserResumeModalState,
  words: ReadonlyArray<GcodeWord>,
  version: LaserResumeTransformVersion,
): boolean {
  const motion = motionForLine(state, words, version);
  const hasXyDestination = words.some(({ letter }) => letter === 'X' || letter === 'Y');
  const hasArcCenter = words.some(({ letter }) => letter === 'I' || letter === 'J');
  const hasDestination = hasXyDestination || ((motion === 'G2' || motion === 'G3') && hasArcCenter);
  return hasDestination && motion !== null && motion !== 'G0';
}

function motionForLine(
  state: LaserResumeModalState,
  words: ReadonlyArray<GcodeWord>,
  version: LaserResumeTransformVersion,
): LaserResumeMotion {
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const word = words[i];
    if (word?.letter !== 'G') continue;
    const explicitMotion = motionFor(word.value);
    if (explicitMotion !== null) return explicitMotion;
  }
  // Transform 2 follows the controller: a modal G word such as G90 or G21 on
  // the line does not stop its axis words running the modal motion. Transform
  // 1 treated any G word as a non-burn line and is kept for archived replays.
  if (version >= 2) return invokesModalMotion(words) ? state.motion : null;
  const hasOtherGCode = words.some(({ letter }) => letter === 'G');
  return hasOtherGCode ? null : state.motion;
}

export function wordsForLine(rawLine: string): ReadonlyArray<GcodeWord> {
  const line = stripComments(rawLine);
  return [...line.matchAll(WORD_RE)].map((match) => ({
    letter: (match[1] ?? '').toUpperCase(),
    value: Number(match[2]),
    text: match[2] ?? '',
  }));
}

function lastWordValue(words: ReadonlyArray<GcodeWord>, letter: string): number | null {
  for (let i = words.length - 1; i >= 0; i -= 1) {
    if (words[i]?.letter === letter) return words[i]?.value ?? null;
  }
  return null;
}

function withPowerWord(rawLine: string, value: number): string {
  return withPowerText(rawLine, formatNumber(value));
}

/** Sets the line's S word to `power`, spelled exactly so, or appends one. */
export function withPowerText(rawLine: string, power: string): string {
  const semicolon = rawLine.indexOf(';');
  const body = semicolon < 0 ? rawLine : rawLine.slice(0, semicolon);
  const comment = semicolon < 0 ? '' : rawLine.slice(semicolon);
  let found = false;
  const replaced = body.replace(POWER_OR_COMMENT_RE, (match, parenthetical: string | undefined) => {
    if (parenthetical !== undefined) return match;
    found = true;
    return `S${power}`;
  });
  if (found) return `${replaced}${comment}`;
  const trimmed = body.trimEnd();
  const trailing = body.slice(trimmed.length);
  return `${trimmed} S${power}${trailing}${comment}`;
}

/** Follows the line's motion words, as the controller's modal motion does. */
export function applyMotionWords(
  state: LaserResumeModalState,
  words: ReadonlyArray<GcodeWord>,
): void {
  for (const { letter, value } of words) {
    const motion = letter === 'G' ? motionFor(value) : null;
    if (motion !== null) state.motion = motion;
  }
}

function motionFor(value: number): Exclude<LaserResumeMotion, null> | null {
  if (value === 0) return 'G0';
  if (value === 1) return 'G1';
  if (value === 2) return 'G2';
  if (value === 3) return 'G3';
  return null;
}

function spindleFor(value: number): LaserResumeModalState['spindle'] | null {
  if (value === 3) return 'M3';
  if (value === 4) return 'M4';
  if (value === 5) return 'M5';
  return null;
}

export function stripComments(line: string): string {
  return line.replace(/\(.*?\)/g, '').replace(/;.*$/, '');
}

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
