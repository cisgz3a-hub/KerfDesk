// ADR-341 Amendment 8 measures the possible unburned XY path after a lost
// link. This independent walk changes no resume transforms or entry points.
import type { XyPoint } from '../../gcode/arc-solve';
import type { LaserResumeModalState } from './laser-resume-reentry';
import { canTrackHeadStopBlock } from './resume-head-stop-block';
import { resumeArcLengthMm } from './resume-travel-arc';

type Word = { readonly letter: string; readonly value: number };
type TravelState = LaserResumeModalState & { incrementalCenters: boolean };
type Block = { readonly words: ReadonlyArray<Word>; readonly values: ReadonlyMap<string, number> };

const WORD_RE = /([A-Za-z])(-?\d+(?:\.\d+)?)/g;
const ARC_WORDS = ['I', 'J', 'R', 'K'];
const MOTION_ADDRESSES = ['X', 'Y', 'Z', ...ARC_WORDS];
const KNOWN_ADDRESSES = new Set(['G', 'M', 'X', 'Y', 'Z', 'I', 'J', 'K', 'R', 'F', 'S', 'P', 'N']);
const PARAMETER_M_WORDS = new Set([106, 107, 221, 400]);
const MODES = new Map<number, Partial<TravelState>>([
  [0, { motion: 'G0' }],
  [1, { motion: 'G1' }],
  [2, { motion: 'G2' }],
  [3, { motion: 'G3' }],
  [17, { plane: 'G17' }],
  [18, { plane: 'G18' }],
  [19, { plane: 'G19' }],
  [20, { units: 'G20' }],
  [21, { units: 'G21' }],
  [90.1, { incrementalCenters: false }],
  [91.1, { incrementalCenters: true }],
]);

/**
 * XY path length in millimetres before toLine, beginning at fromLine. Arcs
 * count their swept length rather than their chord. Null means the block
 * grammar, coordinates or arc geometry cannot establish that measurement.
 * This estimate does not establish which queued commands physically ran.
 */
export function resumeTravelMm(gcode: string, fromLine: number, toLine: number): number | null {
  const lines = gcode.split('\n');
  if (!validSpan(fromLine, toLine, lines.length)) return null;
  const state = initialState();
  let travel = 0;
  // Walk the prefix and counted span once, carrying only diagnostic state.
  for (let i = 0; i < toLine - 1; i += 1) {
    const length = blockTravelMm(state, lines[i] ?? '');
    if (length === null) return null;
    if (i >= fromLine - 1) travel += length;
    if (!Number.isFinite(travel)) return null;
  }
  return travel;
}

function validSpan(fromLine: number, toLine: number, lineCount: number): boolean {
  return (
    Number.isInteger(fromLine) &&
    Number.isInteger(toLine) &&
    fromLine >= 1 &&
    toLine >= fromLine &&
    toLine <= lineCount + 1
  );
}

function initialState(): TravelState {
  // The qualification helper shares the existing coordinate grammar; beam
  // and coolant fields are inert here and never reach executable recovery.
  return {
    units: 'G21',
    spindle: 'M5',
    motion: null,
    wcs: 'G54',
    plane: 'G17',
    sValue: null,
    feed: null,
    x: null,
    y: null,
    mist: false,
    flood: false,
    incrementalCenters: true,
  };
}

function blockTravelMm(state: TravelState, raw: string): number | null {
  const line = raw
    .replace(/\(.*?\)/g, '')
    .replace(/;.*$/, '')
    .trim();
  if (line === '' || line === '%') return 0;
  const block = parseBlock(state, line);
  if (block === null) return null;
  const from = pointMm(state);
  // G-code modal groups govern the whole block, regardless of word order.
  for (const word of block.words) {
    if (word.letter === 'G') Object.assign(state, MODES.get(word.value));
  }
  state.x = block.values.get('X') ?? state.x;
  state.y = block.values.get('Y') ?? state.y;
  const scale = state.units === 'G20' ? 25.4 : 1;
  if (!finiteAxis(state.x, scale) || !finiteAxis(state.y, scale)) return null;
  return movementMm(state, block, from, scale);
}

function parseBlock(state: TravelState, line: string): Block | null {
  const words: Word[] = [...line.matchAll(WORD_RE)].map((match) => ({
    letter: (match[1] ?? '').toUpperCase(),
    value: Number(match[2]),
  }));
  if (words.some((word) => !Number.isFinite(word.value) || !KNOWN_ADDRESSES.has(word.letter)))
    return null;
  if (!unambiguousModes(words)) return null;
  if (!canTrackHeadStopBlock(state, words, line.replace(WORD_RE, '').trim())) return null;
  const values = new Map<string, number>();
  for (const word of words) {
    if (word.letter === 'G' || word.letter === 'M') continue;
    if (values.has(word.letter)) return null;
    values.set(word.letter, word.value);
  }
  return { words, values };
}

function unambiguousModes(words: ReadonlyArray<Word>): boolean {
  const groups = new Set<string>();
  for (const word of words) {
    if (word.letter !== 'G') continue;
    const mode = MODES.get(word.value);
    if (mode === undefined) continue;
    const group = Object.keys(mode)[0] ?? '';
    if (groups.has(group)) return false;
    groups.add(group);
  }
  return true;
}

function movementMm(
  state: TravelState,
  block: Block,
  from: XyPoint | null,
  scale: number,
): number | null {
  if (arcParameterIsUntracked(state, block)) return null;
  if (!hasAny(block.values, MOTION_ADDRESSES)) return 0;
  if (consumesParameters(block.words)) return null;
  if (state.motion === 'G2' || state.motion === 'G3')
    return arcMovementMm(state, block, from, scale);
  // I/J/R are block-local geometry, never implicit movement under G0/G1.
  if (hasAny(block.values, ARC_WORDS)) return null;
  const to = pointMm(state);
  if (from === null || to === null) return 0;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return Number.isFinite(length) ? length : null;
}

function arcMovementMm(
  state: TravelState,
  block: Block,
  from: XyPoint | null,
  scale: number,
): number | null {
  if (state.plane !== 'G17' || !state.incrementalCenters || block.values.has('K')) return null;
  const to = pointMm(state);
  if (from === null || to === null) return null;
  return resumeArcLengthMm(
    from,
    to,
    { i: block.values.get('I'), j: block.values.get('J'), r: block.values.get('R') },
    state.motion === 'G2',
    scale,
  );
}

function arcParameterIsUntracked(state: TravelState, block: Block): boolean {
  if (state.motion !== 'G2' && state.motion !== 'G3') return false;
  // P is qualified for dwell/native controls, but arc-local P semantics are
  // untracked. It must not silently become an ordinary one-sweep estimate.
  return block.values.has('P') && !consumesParameters(block.words);
}

function consumesParameters(words: ReadonlyArray<Word>): boolean {
  return words.some(
    (word) =>
      (word.letter === 'G' && word.value === 4) ||
      (word.letter === 'M' && PARAMETER_M_WORDS.has(word.value)),
  );
}

function hasAny(values: ReadonlyMap<string, number>, letters: ReadonlyArray<string>): boolean {
  return letters.some((letter) => values.has(letter));
}

function finiteAxis(value: number | null, scale: number): boolean {
  return value === null || Number.isFinite(value * scale);
}

function pointMm(state: TravelState): XyPoint | null {
  if (state.x === null || state.y === null) return null;
  const scale = state.units === 'G20' ? 25.4 : 1;
  return { x: state.x * scale, y: state.y * scale };
}
