/** Motion mode known at the laser recovery boundary. */
export type LaserResumeMotion = 'G0' | 'G1' | 'G2' | 'G3' | null;

/** Modal values needed to rebuild a beam-off laser recovery boundary. */
export type LaserResumeModalState = {
  units: 'G20' | 'G21';
  spindle: 'M3' | 'M4' | 'M5';
  motion: LaserResumeMotion;
  sValue: number | null;
  feed: number | null;
  x: number | null;
  y: number | null;
};

type GcodeWord = { readonly letter: string; readonly value: number };
type RewrittenLine = { readonly line: string; readonly physicalPower: number };

const WORD_RE = /([A-Za-z])(-?\d+(?:\.\d+)?)/g;
const POWER_OR_COMMENT_RE = /(\([^)]*\))|[Ss]-?\d+(?:\.\d+)?/g;

/** Keeps replay power at zero until the source program reaches real burn motion. */
export function rewriteLaserResumeTail(
  state: LaserResumeModalState,
  originalTail: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const intended = { ...state };
  const rewritten: string[] = [];
  let physicalPower = 0;
  for (const rawLine of originalTail) {
    const result = rewriteReplayLine(intended, rawLine, physicalPower);
    rewritten.push(result.line);
    physicalPower = result.physicalPower;
  }
  return rewritten;
}

function rewriteReplayLine(
  intended: LaserResumeModalState,
  rawLine: string,
  physicalPower: number,
): RewrittenLine {
  const words = wordsForLine(rawLine);
  applyReplayWords(intended, words);
  const explicitPower = lastWordValue(words, 'S');
  const hasArm = words.some(({ letter, value }) => letter === 'M' && (value === 3 || value === 4));
  if (isBurnMotion(intended, words)) {
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

function isBurnMotion(state: LaserResumeModalState, words: ReadonlyArray<GcodeWord>): boolean {
  const motion = motionForLine(state, words);
  const hasXyDestination = words.some(({ letter }) => letter === 'X' || letter === 'Y');
  const hasArcCenter = words.some(({ letter }) => letter === 'I' || letter === 'J');
  const hasDestination = hasXyDestination || ((motion === 'G2' || motion === 'G3') && hasArcCenter);
  return (
    hasDestination &&
    motion !== null &&
    motion !== 'G0' &&
    state.spindle !== 'M5' &&
    state.sValue !== null &&
    state.sValue > 0
  );
}

function motionForLine(
  state: LaserResumeModalState,
  words: ReadonlyArray<GcodeWord>,
): LaserResumeMotion {
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const word = words[i];
    if (word?.letter !== 'G') continue;
    const explicitMotion = motionFor(word.value);
    if (explicitMotion !== null) return explicitMotion;
  }
  const hasOtherGCode = words.some(({ letter }) => letter === 'G');
  return hasOtherGCode ? null : state.motion;
}

function wordsForLine(rawLine: string): ReadonlyArray<GcodeWord> {
  const line = stripComments(rawLine);
  return [...line.matchAll(WORD_RE)].map((match) => ({
    letter: (match[1] ?? '').toUpperCase(),
    value: Number(match[2]),
  }));
}

function lastWordValue(words: ReadonlyArray<GcodeWord>, letter: string): number | null {
  for (let i = words.length - 1; i >= 0; i -= 1) {
    if (words[i]?.letter === letter) return words[i]?.value ?? null;
  }
  return null;
}

function withPowerWord(rawLine: string, value: number): string {
  const semicolon = rawLine.indexOf(';');
  const body = semicolon < 0 ? rawLine : rawLine.slice(0, semicolon);
  const comment = semicolon < 0 ? '' : rawLine.slice(semicolon);
  let found = false;
  const replaced = body.replace(POWER_OR_COMMENT_RE, (match, parenthetical: string | undefined) => {
    if (parenthetical !== undefined) return match;
    found = true;
    return `S${formatNumber(value)}`;
  });
  if (found) return `${replaced}${comment}`;
  const trimmed = body.trimEnd();
  const trailing = body.slice(trimmed.length);
  return `${trimmed} S${formatNumber(value)}${trailing}${comment}`;
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

function stripComments(line: string): string {
  return line.replace(/\(.*?\)/g, '').replace(/;.*$/, '');
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
