// cnc-pause-reentry-program (ADR-401) — the modal state a CNC re-entry after
// "Pause and lift" must restore, read from the lines the job has already
// streamed.
//
// A re-entry replays the program from one of its own lines. That is only
// sound when every line it replays, and every line before it, uses the modal
// subset KerfDesk's CNC emitter writes (cnc-grbl-transitions.ts): millimetres,
// absolute distance, G54, units-per-minute feed, the XY plane, G0-G3, G4
// dwells, M3/M4/M5 and M7/M8/M9. Anything else (G91, G92, G53, G28, another
// work system, inches, a tool-length offset, an unknown word) changes the
// frame or the state in ways a replay cannot reproduce, so the scan refuses
// and Pause stays the plain safety-door pause.

import { isToolChangeLine } from '../controllers/grbl/streamer';
import { scanGcodeWords, stripInlineComments } from '../gcode';

const SUPPORTED_G_CODES: ReadonlySet<number> = new Set([
  0, 1, 2, 3, 4, 17, 21, 40, 54, 90, 91.1, 94,
]);
const SUPPORTED_M_CODES: ReadonlySet<number> = new Set([0, 1, 3, 4, 5, 7, 8, 9]);
const SUPPORTED_LETTERS: ReadonlySet<string> = new Set([
  'G',
  'M',
  'N',
  'F',
  'S',
  'P',
  'X',
  'Y',
  'Z',
  'I',
  'J',
  'K',
  'R',
]);

export type CncMotionMode = 0 | 1 | 2 | 3;

/** Modal state in effect when a line starts executing. */
export type CncReentryModal = {
  readonly motion: CncMotionMode;
  readonly feedMmPerMin: number;
  readonly spindle: 'M3' | 'M4' | null;
  readonly spindleRpm: number;
  /** The G4 dwell the program ran after its latest spindle start, if any. */
  readonly spinupSec: number | null;
  readonly mist: boolean;
  readonly flood: boolean;
};

export type CncReentryScan =
  | {
      readonly ok: true;
      /** Modal state just before the resume line runs. */
      readonly atResume: CncReentryModal;
      /** Motion mode each scanned line executes in (its own G word applied). */
      readonly motionAt: Uint8Array;
      /** Feed in effect for each scanned line (its own F word applied). */
      readonly feedAt: Float64Array;
      /** The resume line names its own G2/G3 when it is an arc. */
      readonly resumeLineNamesArc: boolean;
    }
  | { readonly ok: false; readonly reason: string };

type MutableModal = {
  motion: CncMotionMode;
  feedMmPerMin: number;
  spindle: 'M3' | 'M4' | null;
  spindleRpm: number;
  spinupSec: number | null;
  awaitingSpinupDwell: boolean;
  mist: boolean;
  flood: boolean;
};

type LineWords = {
  readonly gCodes: ReadonlyArray<number>;
  readonly mCodes: ReadonlyArray<number>;
  readonly values: ReadonlyMap<string, number>;
};

/**
 * Validates lines [0, scanEnd) and records the modal state before
 * `resumeIndex`. `scanEnd` must cover every line the re-entry will replay
 * that the controller had already accepted.
 */
export function scanCncReentryProgram(
  lines: ReadonlyArray<string>,
  resumeIndex: number,
  scanEnd: number,
): CncReentryScan {
  const end = Math.min(scanEnd, lines.length);
  const motionAt = new Uint8Array(end);
  const feedAt = new Float64Array(end);
  const modal: MutableModal = {
    motion: 0,
    feedMmPerMin: 0,
    spindle: null,
    spindleRpm: 0,
    spinupSec: null,
    awaitingSpinupDwell: false,
    mist: false,
    flood: false,
  };
  let atResume: CncReentryModal | null = null;
  let resumeLineNamesArc = false;
  for (let index = 0; index < end; index += 1) {
    if (index === resumeIndex) atResume = snapshot(modal);
    const line = lines[index] ?? '';
    // The streamer holds a tool-change M0 back host-side; it never runs.
    if (isToolChangeLine(line)) continue;
    const words = lineWords(line);
    const refusal = unsupportedWord(words, index);
    if (refusal !== null) return { ok: false, reason: refusal };
    applyLine(modal, words);
    motionAt[index] = modal.motion;
    feedAt[index] = modal.feedMmPerMin;
    if (index === resumeIndex) {
      resumeLineNamesArc = words.gCodes.some((code) => code === 2 || code === 3);
    }
  }
  if (atResume === null) {
    return { ok: false, reason: 'The re-entry line lies outside the streamed program.' };
  }
  return { ok: true, atResume, motionAt, feedAt, resumeLineNamesArc };
}

function lineWords(line: string): LineWords {
  const gCodes: number[] = [];
  const mCodes: number[] = [];
  const values = new Map<string, number>();
  for (const word of scanGcodeWords(stripInlineComments(line))) {
    if (word.letter === 'G') gCodes.push(word.value);
    else if (word.letter === 'M') mCodes.push(word.value);
    else values.set(word.letter, word.value);
  }
  return { gCodes, mCodes, values };
}

function unsupportedWord(words: LineWords, index: number): string | null {
  const where = `streamed line ${index + 1}`;
  const g = words.gCodes.find((code) => !SUPPORTED_G_CODES.has(code));
  if (g !== undefined) return `G${g} on ${where} is outside the re-entry subset.`;
  const m = words.mCodes.find((code) => !SUPPORTED_M_CODES.has(code));
  if (m !== undefined) return `M${m} on ${where} is outside the re-entry subset.`;
  for (const [letter, value] of words.values) {
    if (!SUPPORTED_LETTERS.has(letter) || !Number.isFinite(value)) {
      return `The ${letter} word on ${where} is outside the re-entry subset.`;
    }
  }
  if (words.values.has('P') && !words.gCodes.includes(4)) {
    return `A P word without G4 on ${where} is outside the re-entry subset.`;
  }
  return null;
}

function applyLine(modal: MutableModal, words: LineWords): void {
  for (const code of words.gCodes) {
    if (code === 0 || code === 1 || code === 2 || code === 3) modal.motion = code;
  }
  const feed = words.values.get('F');
  if (feed !== undefined) modal.feedMmPerMin = feed;
  const rpm = words.values.get('S');
  if (rpm !== undefined) modal.spindleRpm = rpm;
  for (const code of words.mCodes) applyMCode(modal, code);
  applySpinupDwell(modal, words);
}

// The spin-up is the first dwell after M3/M4, before any move.
function applySpinupDwell(modal: MutableModal, words: LineWords): void {
  if (words.gCodes.includes(4)) {
    const seconds = words.values.get('P');
    if (modal.awaitingSpinupDwell && seconds !== undefined && seconds > 0) {
      modal.spinupSec = seconds;
    }
    modal.awaitingSpinupDwell = false;
  } else if (['X', 'Y', 'Z'].some((axis) => words.values.has(axis))) {
    modal.awaitingSpinupDwell = false;
  }
}

function applyMCode(modal: MutableModal, code: number): void {
  if (code === 3 || code === 4) {
    modal.spindle = code === 3 ? 'M3' : 'M4';
    modal.spinupSec = null;
    modal.awaitingSpinupDwell = true;
  } else if (code === 5) {
    modal.spindle = null;
    modal.awaitingSpinupDwell = false;
  } else if (code === 7) {
    modal.mist = true;
  } else if (code === 8) {
    modal.flood = true;
  } else if (code === 9) {
    modal.mist = false;
    modal.flood = false;
  }
}

function snapshot(modal: MutableModal): CncReentryModal {
  return {
    motion: modal.motion,
    feedMmPerMin: modal.feedMmPerMin,
    spindle: modal.spindle,
    spindleRpm: modal.spindleRpm,
    spinupSec: modal.spinupSec,
    mist: modal.mist,
    flood: modal.flood,
  };
}
