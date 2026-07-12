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
  readonly machineKind: 'laser' | 'cnc';
  readonly safeZMm: number;
  readonly spindleSpinupSec: number;
  readonly plungeMmPerMin: number;
};

type ModalState = {
  units: 'G20' | 'G21';
  spindle: 'M3' | 'M4' | 'M5';
  lastActiveSpindle: 'M3' | 'M4' | null;
  // Modal motion mode. A G0 rapid ignores F; only a G1 feed move carries a real
  // plunge feed. null until the first G0/G1 word is seen.
  motionMode: 'G0' | 'G1' | null;
  sValue: number | null;
  feed: number | null;
  x: number | null;
  y: number | null;
  z: number | null;
  // Feed of the most recent G1 move that LOWERED Z — a pure `G1 Z<d> F<f>`
  // (GrblStrategy's per-pass signature) OR a ramp/relief move carrying X/Y/Z/F.
  // null until one is seen, then used for the re-entry descent instead of the
  // caller's fallback plungeMmPerMin.
  plungeMmPerMin: number | null;
};

type GcodeWord = { readonly letter: string; readonly value: number };

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
    lastActiveSpindle: null,
    motionMode: null,
    sValue: null,
    feed: null,
    x: null,
    y: null,
    z: null,
    plungeMmPerMin: null,
  };
  for (let i = 0; i < fromLine - 1; i += 1) {
    const issue = applyLine(state, lines[i] ?? '');
    if (issue !== null) return { kind: 'error', reason: `Line ${i + 1}: ${issue}` };
  }
  const recoveryLine =
    options.machineKind === 'cnc'
      ? findCncSafeBoundary(lines, fromLine, state.units, options.safeZMm)
      : fromLine;
  if (recoveryLine === null) {
    return {
      kind: 'error',
      reason: 'No prior safe retract boundary exists for this CNC resume point.',
    };
  }
  const tail = lines.slice(recoveryLine - 1);
  if (tail.every((line) => stripComments(line).trim() === '')) {
    return { kind: 'error', reason: 'Nothing left to run from that line.' };
  }
  const preamble = buildPreamble(state, options);
  return {
    kind: 'ok',
    lines: [...preamble, ...tail],
    fromLine: recoveryLine,
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
  const prevZ = state.z;
  for (const { letter, value } of words) {
    const issue = applyWord(state, letter, value);
    if (issue !== null) return issue;
  }
  recordPlungeFeed(state, prevZ);
  return null;
}

// The plunge feed is the feed of a G1 move that LOWERS Z — whether a pure
// `G1 Z<d> F<f>` (GrblStrategy's per-pass signature) or a ramp/relief move that
// also carries X/Y. Recovering it from ramps means a relief/ramp-only program no
// longer resumes at the caller's fallback feed (Codex audit). Guarded so it can
// only DROP the recorded feed: a G0 rapid ignores F, and a lateral or UPWARD
// (retract) G1 move's F is a cutting/retract feed, not a plunge — neither may
// hijack the value. Z direction needs a known previous Z, so the first Z move
// before any reference height is skipped rather than guessed.
function recordPlungeFeed(state: ModalState, prevZ: number | null): void {
  if (state.motionMode !== 'G1') return;
  if (state.z === null || prevZ === null || state.z >= prevZ) return;
  if (state.feed !== null && Number.isFinite(state.feed) && state.feed > 0) {
    state.plungeMmPerMin = state.feed;
  }
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
  if (value === 0) state.motionMode = 'G0';
  if (value === 1) state.motionMode = 'G1';
  if (value === 91) return 'relative positioning (G91) — resume needs absolute programs';
  // Machine-coordinate and predefined-position moves change the position
  // without updating the tracked X/Y/Z modal words, so the replayed re-entry
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
  if (value === 3) {
    state.spindle = 'M3';
    state.lastActiveSpindle = 'M3';
  }
  if (value === 4) {
    state.spindle = 'M4';
    state.lastActiveSpindle = 'M4';
  }
  if (value === 5) state.spindle = 'M5';
}

function buildPreamble(state: ModalState, options: ResumeOptions): ReadonlyArray<string> {
  const header: string[] = ['; KerfDesk resume preamble', state.units, 'G90'];
  // Recovery order is machine-specific. CNC extracts Z before commanding a
  // spindle restart; laser positions with the beam off before it is armed.
  const body =
    options.machineKind === 'cnc' ? cncResumeBody(state, options) : laserResumeBody(state);
  return [...header, ...body];
}

// CNC recovery rewinds to a pure safe-Z boundary. Extract first so a stopped
// spindle is never asked to accelerate while the bit is embedded; then spin up
// at clearance. The replayed boundary owns XY positioning and the plunge.
function cncResumeBody(state: ModalState, options: ResumeOptions): string[] {
  const safeZ = programUnitsFromMm(options.safeZMm, state.units);
  const fallbackFeed = programUnitsFromMm(options.plungeMmPerMin, state.units);
  const extractionFeed = state.plungeMmPerMin ?? fallbackFeed;
  const lines: string[] = [`G1 Z${formatNumber(safeZ)} F${formatNumber(extractionFeed)}`];
  if (state.lastActiveSpindle !== null && state.sValue !== null) {
    lines.push(`${state.lastActiveSpindle} S${formatNumber(state.sValue)}`);
    lines.push(`G4 P${options.spindleSpinupSec.toFixed(3)}`);
  }
  return lines;
}

// Laser re-entry: position FIRST with the beam off (no spindle word emitted yet),
// and only once the head is at the resume point re-arm it — where a burn is
// expected. No spin-up dwell: a G4 with M3 active fires the stationary beam
// (audit C1). No Z words: laser jobs must never command the Z axis on resume.
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

// The rapid to the resume XY, or null when neither axis was ever set.
function positionMove(state: ModalState): string | null {
  if (state.x === null && state.y === null) return null;
  const x = state.x === null ? '' : ` X${formatNumber(state.x)}`;
  const y = state.y === null ? '' : ` Y${formatNumber(state.y)}`;
  return `G0${x}${y}`;
}

function findCncSafeBoundary(
  lines: ReadonlyArray<string>,
  fromLine: number,
  units: ModalState['units'],
  safeZMm: number,
): number | null {
  const safeZ = programUnitsFromMm(safeZMm, units);
  for (let index = fromLine - 1; index >= 0; index -= 1) {
    if (isPureSafeRetract(lines[index] ?? '', safeZ)) return index + 1;
  }
  return null;
}

function isPureSafeRetract(rawLine: string, safeZ: number): boolean {
  const words: GcodeWord[] = [...stripComments(rawLine).matchAll(WORD_RE)].map((match) => ({
    letter: (match[1] ?? '').toUpperCase(),
    value: Number(match[2]),
  }));
  const isRapid = words.some((word) => word.letter === 'G' && word.value === 0);
  const z = words.find((word) => word.letter === 'Z')?.value;
  const hasLateralMotion = words.some((word) => word.letter === 'X' || word.letter === 'Y');
  return isRapid && z !== undefined && z >= safeZ && !hasLateralMotion;
}

function programUnitsFromMm(value: number, units: ModalState['units']): number {
  const mmPerInch = 25.4;
  return units === 'G20' ? value / mmPerInch : value;
}

function stripComments(line: string): string {
  return line.replace(/\(.*?\)/g, '').replace(/;.*$/, '');
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
