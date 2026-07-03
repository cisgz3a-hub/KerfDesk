// Start-from-line job recovery (ADR-103 G7, F-CNC27) — the gSender-style
// resume: scan the program's modal state up to the chosen line, then emit a
// safe re-entry preamble (units/positioning, spindle + spin-up, feed, safe-Z
// travel to the resume XY, feed back down to the recorded depth) followed by
// the remaining lines verbatim.
//
// Refuses (Result union, never throws) when the line is out of range, when
// relative positioning (G91) appears before the resume point (the replay
// math would need full simulation), or when nothing remains to run.

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

export type ResumeOptions = {
  readonly safeZMm: number;
  readonly spindleSpinupSec: number;
  readonly plungeMmPerMin: number;
};

type ModalState = {
  units: 'G20' | 'G21';
  spindle: 'M3' | 'M4' | 'M5';
  sValue: number | null;
  feed: number | null;
  x: number | null;
  y: number | null;
  z: number | null;
};

const WORD_RE = /([A-Za-z])(-?\d+(?:\.\d+)?)/g;

export function buildResumeProgram(
  gcode: string,
  fromLine: number,
  options: ResumeOptions,
): ResumeProgramResult {
  const lines = gcode.split('\n');
  if (!Number.isInteger(fromLine) || fromLine < 1 || fromLine > lines.length) {
    return { kind: 'error', reason: `Line must be between 1 and ${lines.length}.` };
  }
  const state: ModalState = {
    units: 'G21',
    spindle: 'M5',
    sValue: null,
    feed: null,
    x: null,
    y: null,
    z: null,
  };
  for (let i = 0; i < fromLine - 1; i += 1) {
    const issue = applyLine(state, lines[i] ?? '');
    if (issue !== null) return { kind: 'error', reason: `Line ${i + 1}: ${issue}` };
  }
  const tail = lines.slice(fromLine - 1);
  if (tail.every((line) => stripComments(line).trim() === '')) {
    return { kind: 'error', reason: 'Nothing left to run from that line.' };
  }
  const preamble = buildPreamble(state, options);
  return {
    kind: 'ok',
    lines: [...preamble, ...tail],
    fromLine,
    preambleCount: preamble.length,
  };
}

// Returns an error string for constructs the replay cannot handle.
function applyLine(state: ModalState, rawLine: string): string | null {
  const line = stripComments(rawLine);
  if (line.trim() === '' || line.trim() === '%') return null;
  for (const match of line.matchAll(WORD_RE)) {
    const letter = (match[1] ?? '').toUpperCase();
    const value = Number(match[2]);
    const issue = applyWord(state, letter, value);
    if (issue !== null) return issue;
  }
  return null;
}

function applyWord(state: ModalState, letter: string, value: number): string | null {
  if (letter === 'G') return applyGWord(state, value);
  if (letter === 'M') {
    applyMWord(state, value);
    return null;
  }
  if (letter === 'S') state.sValue = value;
  if (letter === 'F') state.feed = value;
  if (letter === 'X') state.x = value;
  if (letter === 'Y') state.y = value;
  if (letter === 'Z') state.z = value;
  return null;
}

function applyGWord(state: ModalState, value: number): string | null {
  if (value === 91) return 'relative positioning (G91) — resume needs absolute programs';
  if (value === 20) state.units = 'G20';
  if (value === 21) state.units = 'G21';
  return null;
}

function applyMWord(state: ModalState, value: number): void {
  if (value === 3) state.spindle = 'M3';
  if (value === 4) state.spindle = 'M4';
  if (value === 5) state.spindle = 'M5';
}

function buildPreamble(state: ModalState, options: ResumeOptions): ReadonlyArray<string> {
  const lines: string[] = ['; KerfDesk resume preamble', state.units, 'G90'];
  if (state.spindle !== 'M5' && state.sValue !== null) {
    lines.push(`${state.spindle} S${formatNumber(state.sValue)}`);
    lines.push(`G4 P${options.spindleSpinupSec.toFixed(3)}`);
  }
  // Z lines only when the program itself is Z-aware — a laser job with no
  // Z words must not suddenly command the Z axis on resume.
  if (state.z !== null) lines.push(`G0 Z${formatNumber(options.safeZMm)}`);
  if (state.x !== null || state.y !== null) {
    const x = state.x === null ? '' : ` X${formatNumber(state.x)}`;
    const y = state.y === null ? '' : ` Y${formatNumber(state.y)}`;
    lines.push(`G0${x}${y}`);
  }
  // Feed back down to the recorded depth so XY-only cut lines that follow
  // resume in the material, not at safe height.
  if (state.z !== null && state.z < options.safeZMm) {
    lines.push(`G1 Z${formatNumber(state.z)} F${formatNumber(options.plungeMmPerMin)}`);
  }
  if (state.feed !== null) lines.push(`F${formatNumber(state.feed)}`);
  return lines;
}

function stripComments(line: string): string {
  return line.replace(/\(.*?\)/g, '').replace(/;.*$/, '');
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
