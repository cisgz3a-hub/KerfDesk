// Laser start-from-line recovery (ADR-103 G7, ADR-141): scan the program's
// modal state up to the chosen line, then position with the beam off before
// replaying the remaining lines verbatim. Automatic CNC recovery is refused:
// controller acknowledgements cannot establish physical execution or cutter
// clearance after an interruption.

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
};

type ModalState = {
  units: 'G20' | 'G21';
  spindle: 'M3' | 'M4' | 'M5';
  sValue: number | null;
  feed: number | null;
  x: number | null;
  y: number | null;
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
  const state: ModalState = {
    units: 'G21',
    spindle: 'M5',
    sValue: null,
    feed: null,
    x: null,
    y: null,
  };
  for (let i = 0; i < fromLine - 1; i += 1) {
    const issue = applyLine(state, lines[i] ?? '');
    if (issue !== null) return { kind: 'error', reason: `Line ${i + 1}: ${issue}` };
  }
  const tail = lines.slice(fromLine - 1);
  if (tail.every((line) => stripComments(line).trim() === '')) {
    return { kind: 'error', reason: 'Nothing left to run from that line.' };
  }
  const preamble = buildPreamble(state);
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
  return null;
}

function applyGWord(state: ModalState, value: number): string | null {
  if (value === 91) return 'relative positioning (G91) — resume needs absolute programs';
  // Machine-coordinate and predefined-position moves change the position
  // without updating the tracked X/Y modal words, so the replayed re-entry
  // would target the wrong point. KerfDesk's own emitters never produce
  // them; imported external G-code can (audit F11).
  if (value === 53) return 'machine-coordinate motion (G53) — resume tracks work coordinates only';
  if (value === 28 || value === 30) {
    return `predefined-position move (G${value}) — resume cannot track its endpoint`;
  }
  if (value === 20) state.units = 'G20';
  if (value === 21) state.units = 'G21';
  return null;
}

function applyMWord(state: ModalState, value: number): void {
  if (value === 3) state.spindle = 'M3';
  if (value === 4) state.spindle = 'M4';
  if (value === 5) state.spindle = 'M5';
}

function buildPreamble(state: ModalState): ReadonlyArray<string> {
  return ['; KerfDesk resume preamble', state.units, 'G90', ...laserResumeBody(state)];
}

// Laser re-entry: position FIRST with the beam off (no spindle word emitted yet),
// and only once the head is at the resume point re-arm it — where a burn is
// expected. No spin-up dwell: a G4 with M3 active fires the stationary beam.
// No Z words: laser jobs must never command the Z axis on resume.
function laserResumeBody(state: ModalState): string[] {
  const lines: string[] = [];
  const move = positionMove(state);
  if (move !== null) lines.push(move);
  if (state.spindle !== 'M5' && state.sValue !== null) {
    lines.push(`${state.spindle} S${formatNumber(state.sValue)}`);
  }
  if (state.feed !== null) lines.push(`F${formatNumber(state.feed)}`);
  return lines;
}

function positionMove(state: ModalState): string | null {
  if (state.x === null && state.y === null) return null;
  const x = state.x === null ? '' : ` X${formatNumber(state.x)}`;
  const y = state.y === null ? '' : ` Y${formatNumber(state.y)}`;
  return `G0${x}${y}`;
}

function stripComments(line: string): string {
  return line.replace(/\(.*?\)/g, '').replace(/;.*$/, '');
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
