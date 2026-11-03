// The beam a Marlin stream holds, by position, for a stream-side Pause
// (performance audit S1-P1-1, ADR-676 Amendment 3). A Pause must put its
// beam-off on the wire without walking the program: at 739k lines that walk
// held the UI thread for about 300 ms between the refill's release and the
// beam-off, and the stopped fan-dialect head stayed lit meanwhile.
//
// Each stream's lines are read once, in two passes that run in slices behind
// Start (laser-stream-pause-beam.ts) and that any question finishes only as far
// as it needs:
//  - Facts: for each position, the last M106/M107 before it; and, once every
//    line is read, the last line that lights the fan or arms the inline beam.
//    Only lines with an M are parsed, and each distinct one once.
//  - Inline replay, only for a program with an inline mode switch: the inline
//    beam at every INLINE_STRIDE-th position. A question replays at most one
//    stride from there. The beam is followed afresh from each switch, so it is
//    the beam the old walk back to the last switch found.
// Stream line arrays are never changed in place. Resume's restated line makes a
// new array, which takes the index over (carryMarlinStreamPauseBeam).

import { stripComments, wordsForLine, type GcodeWord } from '../grbl/laser-resume-reentry';
import {
  applyNativeBeamLine,
  createNativeLaserBeam,
  nativeBeamArmed,
  type NativeLaserBeam,
  type PowerWord,
} from '../grbl/native-laser-resume-beam';

export type HeldInlineBeam = {
  /** The inline mode the program selected; M5 I leaves it. */
  readonly mode: 'M3' | 'M4';
  /** The inline output is enabled (M3 I / M4 I), so moves burn. */
  readonly armed: boolean;
  /** The power a burn move without its own S word runs at. */
  readonly power: PowerWord | null;
};

/** What one stream line is to the beam decision. */
type LineBeamFacts = {
  /** M106 or M107: the fan speed the lines before a position leave. */
  readonly fanCommand: boolean;
  /** M106 with a speed above zero. */
  readonly litsFan: boolean;
  /** M3 I, M4 I or M5 I: the inline beam is followed afresh from here. */
  readonly inlineSwitch: boolean;
  /** M3 I or M4 I. */
  readonly armsInline: boolean;
};

type StreamBeamIndex = {
  /** Distinct M lines already read. */
  readonly factsByLine: Map<string, LineBeamFacts>;
  /** Lines [0, factsRead) are read. */
  factsRead: number;
  /** At position p <= factsRead, the last M106/M107 line before p, or -1. */
  readonly fanCommandBefore: Int32Array;
  lastFanCommand: number;
  /** The last line read that lights the fan, or -1. */
  lastFanLight: number;
  /** The last line read that arms the inline beam, or -1. */
  lastInlineArm: number;
  /** The first inline mode switch read, or -1. */
  firstInlineSwitch: number;
  /** Lines [0, replayed) are replayed. */
  replayed: number;
  replayBeam: NativeLaserBeam | null;
  /** Entry k: the inline beam before line k * INLINE_STRIDE; null before the
   * first switch. */
  readonly inlineCheckpoints: Array<NativeLaserBeam | null>;
};

// M106 without S runs the fan at full speed (M106_M107.cpp: dspeed = 255).
export const FULL_FAN: PowerWord = { value: 255, text: '255' };
/** A question replays at most this many lines past an inline checkpoint. */
export const INLINE_STRIDE = 256;
// One background slice: about 2 ms of facts, or about 4 ms of inline replay,
// on the PC that measured S1.
const FACTS_SLICE_LINES = 16_384;
const REPLAY_SLICE_LINES = 2048;
// A program of distinct power values (`M106 S12.345`, …) stops being memoized
// here; its lines are then parsed each time, as before.
const MAX_MEMOIZED_LINES = 4096;
const NO_FACTS: LineBeamFacts = {
  fanCommand: false,
  litsFan: false,
  inlineSwitch: false,
  armsInline: false,
};

const streamIndexes = new WeakMap<ReadonlyArray<string>, StreamBeamIndex>();

/** Reads one slice of the stream's beam facts; true once nothing is left that
 * a Pause could need. */
export function prepareMarlinStreamPauseBeamSlice(
  streamLines: ReadonlyArray<string>,
  factsLines = FACTS_SLICE_LINES,
  replayLines = REPLAY_SLICE_LINES,
): boolean {
  const index = streamBeamIndex(streamLines);
  const length = streamLines.length;
  if (index.factsRead < length) {
    readFacts(index, streamLines, Math.min(length, index.factsRead + factsLines));
    return false;
  }
  if (index.firstInlineSwitch < 0) return true;
  replayInline(index, streamLines, Math.min(length, index.replayed + replayLines));
  return index.replayed === length;
}

/** Reads all of the stream's beam facts now. */
export function prepareMarlinStreamPauseBeam(streamLines: ReadonlyArray<string>): void {
  while (!prepareMarlinStreamPauseBeamSlice(streamLines, Infinity, Infinity));
}

/** `restated` is `streamLines` with one burn move given the inline power it
 * already runs at (the plan's `restatedLine`). In inline mode the power held
 * above zero is always the unit power, so the move leaves the same beam, and
 * what was read for `streamLines` holds for `restated`. */
export function carryMarlinStreamPauseBeam(
  streamLines: ReadonlyArray<string>,
  restated: ReadonlyArray<string>,
): void {
  const index = streamIndexes.get(streamLines);
  if (index !== undefined && restated.length === streamLines.length) {
    streamIndexes.set(restated, index);
  }
}

/** The fan speed lines [0, sent) left, when it is above zero. */
export function heldFanPower(lines: ReadonlyArray<string>, sent: number): PowerWord | null {
  const index = streamBeamIndex(lines);
  readFacts(index, lines, sent);
  const last = index.fanCommandBefore[sent] ?? -1;
  if (last < 0) return null;
  const words = wordsForLine(lines[last] ?? '');
  if (marlinCommand(words)?.value === 107) return null;
  const power = lastWord(words, 'S') ?? FULL_FAN;
  return power.value > 0 ? power : null;
}

/** The inline cutter lines [0, sent) left, or null when inline mode is off. */
export function heldInlineBeam(lines: ReadonlyArray<string>, sent: number): HeldInlineBeam | null {
  const index = streamBeamIndex(lines);
  readFacts(index, lines, sent);
  if (index.firstInlineSwitch < 0 || index.firstInlineSwitch >= sent) return null;
  const from = sent - (sent % INLINE_STRIDE);
  replayInline(index, lines, from);
  const checkpoint = index.inlineCheckpoints[from / INLINE_STRIDE] ?? null;
  let beam = checkpoint === null ? null : { ...checkpoint };
  for (let position = from; position < sent; position += 1) {
    const line = lines[position] ?? '';
    beam = followInlineBeam(beam, line, memoizedFacts(index, line));
  }
  if (beam === null || beam.inlineMode === null) return null;
  return { mode: beam.inlineMode, armed: nativeBeamArmed(beam), power: beam.power };
}

/** Some line at `from` or later lights the fan / arms the inline beam. */
export function laterBeamLights(
  lines: ReadonlyArray<string>,
  from: number,
): { readonly fan: boolean; readonly inline: boolean } {
  const index = streamBeamIndex(lines);
  readFacts(index, lines, lines.length);
  return { fan: index.lastFanLight >= from, inline: index.lastInlineArm >= from };
}

// Marlin runs one command per line: the first G or M word; the rest are its
// parameters.
export function marlinCommand(words: ReadonlyArray<GcodeWord>): GcodeWord | null {
  return words.find(({ letter }) => letter === 'G' || letter === 'M') ?? null;
}

export function lastWord(words: ReadonlyArray<GcodeWord>, letter: string): PowerWord | null {
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index];
    if (word?.letter === letter) return word;
  }
  return null;
}

function streamBeamIndex(lines: ReadonlyArray<string>): StreamBeamIndex {
  let index = streamIndexes.get(lines);
  if (index === undefined) {
    const fanCommandBefore = new Int32Array(lines.length + 1);
    fanCommandBefore[0] = -1;
    index = {
      factsByLine: new Map(),
      factsRead: 0,
      fanCommandBefore,
      lastFanCommand: -1,
      lastFanLight: -1,
      lastInlineArm: -1,
      firstInlineSwitch: -1,
      replayed: 0,
      replayBeam: null,
      inlineCheckpoints: [null],
    };
    streamIndexes.set(lines, index);
  }
  return index;
}

function readFacts(index: StreamBeamIndex, lines: ReadonlyArray<string>, until: number): void {
  for (let position = index.factsRead; position < until; position += 1) {
    const facts = memoizedFacts(index, lines[position] ?? '');
    if (facts.fanCommand) index.lastFanCommand = position;
    if (facts.litsFan) index.lastFanLight = position;
    if (facts.armsInline) index.lastInlineArm = position;
    if (facts.inlineSwitch && index.firstInlineSwitch < 0) index.firstInlineSwitch = position;
    index.fanCommandBefore[position + 1] = index.lastFanCommand;
  }
  index.factsRead = Math.max(index.factsRead, until);
}

function replayInline(index: StreamBeamIndex, lines: ReadonlyArray<string>, until: number): void {
  for (let position = index.replayed; position < until; position += 1) {
    const line = lines[position] ?? '';
    index.replayBeam = followInlineBeam(index.replayBeam, line, memoizedFacts(index, line));
    if ((position + 1) % INLINE_STRIDE === 0) {
      index.inlineCheckpoints.push(index.replayBeam === null ? null : { ...index.replayBeam });
    }
  }
  index.replayed = Math.max(index.replayed, until);
}

// The inline beam is followed afresh from each inline mode switch.
function followInlineBeam(
  beam: NativeLaserBeam | null,
  line: string,
  facts: LineBeamFacts,
): NativeLaserBeam | null {
  const followed = facts.inlineSwitch ? createNativeLaserBeam('marlin-inline') : beam;
  if (followed !== null) applyNativeBeamLine(followed, line, wordsForLine(line));
  return followed;
}

// A program repeats its power commands (`M107`, `M106 S<n>`), so each
// distinct M line is parsed once.
function memoizedFacts(index: StreamBeamIndex, line: string): LineBeamFacts {
  if (!/m/i.test(line)) return NO_FACTS;
  const known = index.factsByLine.get(line);
  if (known !== undefined) return known;
  const facts = lineBeamFacts(line);
  if (index.factsByLine.size < MAX_MEMOIZED_LINES) index.factsByLine.set(line, facts);
  return facts;
}

function lineBeamFacts(line: string): LineBeamFacts {
  const words = wordsForLine(line);
  const command = marlinCommand(words);
  if (command?.letter !== 'M') return NO_FACTS;
  const inlineSwitch =
    [3, 4, 5].includes(command.value) && /\bI(?=\s|$)/i.test(stripComments(line));
  return {
    fanCommand: command.value === 106 || command.value === 107,
    litsFan: command.value === 106 && (lastWord(words, 'S') ?? FULL_FAN).value > 0,
    inlineSwitch,
    armsInline: inlineSwitch && command.value !== 5,
  };
}
