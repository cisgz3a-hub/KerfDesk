// How an emitted motion block spells its words (ADR-332).
//
// Scanline output is the only place where G-code volume matters: a dithered
// raster row emits one short G1 per power change, and those lines are what a
// character-counting sender has to fit in the controller's receive window and
// push down a 115200-baud link. Measured on a 40 x 30 mm photo at 10 lines/mm,
// 48% of the raster section's bytes were the repeated `G1` word, trailing
// fractional zeros, and the spaces between words.
//
// Compact spelling removes those without changing a single commanded position:
//
//   * Motion mode is modal. `G1` need not be repeated while G1 is already
//     active, and grbl 1.1's `gc_execute_block` treats a block with axis words
//     and no motion word as motion in the current mode. Every reader in this
//     repository does the same, gating on axis words rather than a G word
//     (`core/gcode/modal-axes.ts` is the one shared engine).
//   * Axis words are modal. An axis that does not change may be omitted.
//   * Whitespace between words carries no meaning: grbl's protocol discards it
//     on receive, and `GCODE_WORD_PATTERN` matches adjacent words such as
//     `G1X5` by construction.
//   * `10.000` and `10` are the same number.
//
// This is spelling only. Nothing here decides a coordinate, a feed or a power
// value, and the verbose style keeps the historical byte-for-byte output for
// the conservative dialects.

import { formatGcodeCoordinateMm } from './coordinate-format';

export type MotionWordStyle = {
  /** Omit the motion word while the previous block already selected it. */
  readonly modalMotion: boolean;
  /** Omit an axis word whose value the previous block already left in place. */
  readonly modalAxes: boolean;
  /** Write `10` rather than `10.000`. */
  readonly trimTrailingZeros: boolean;
  /** Write `G1X10` rather than `G1 X10`. */
  readonly packWords: boolean;
};

/** The historical spelling: every word, every decimal, spaces throughout. */
export const VERBOSE_MOTION_WORDS: MotionWordStyle = {
  modalMotion: false,
  modalAxes: false,
  trimTrailingZeros: false,
  packWords: false,
};

export const COMPACT_MOTION_WORDS: MotionWordStyle = {
  modalMotion: true,
  modalAxes: true,
  trimTrailingZeros: true,
  packWords: true,
};

export function motionWordStyleFor(compact: boolean): MotionWordStyle {
  return compact ? COMPACT_MOTION_WORDS : VERBOSE_MOTION_WORDS;
}

/**
 * Formats one millimetre coordinate for a motion word. Identical to
 * `formatGcodeCoordinateMm` except that a compact style drops fractional
 * trailing zeros — `10.000` becomes `10`, `0.100` becomes `0.1`, and a zero
 * stays `0`. The trimmed text parses to exactly the same number, so the
 * emitted position is unchanged.
 */
export function formatMotionCoordinateMm(value: number, style: MotionWordStyle): string {
  const formatted = formatGcodeCoordinateMm(value);
  return style.trimTrailingZeros ? trimTrailingZeros(formatted) : formatted;
}

function trimTrailingZeros(formatted: string): string {
  if (!formatted.includes('.')) return formatted;
  const trimmed = formatted.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}

/**
 * Joins the words of one block, dropping the empties. A trailing comment stays
 * space-separated from the code even in a packed block so `;` cannot fuse onto
 * a value.
 */
export function joinMotionWords(
  words: ReadonlyArray<string>,
  style: MotionWordStyle,
  comment?: string,
): string {
  const block = words.filter((word) => word !== '').join(style.packWords ? '' : ' ');
  return comment === undefined ? block : `${block} ; ${comment}`;
}

/** Tracks what the controller's modal state already holds, so a compact style
 * can omit a word the previous block left at the value this block wants. */
export type ModalMotionWriter = {
  /** The motion word to write for this block, `''` when it may be held. */
  readonly motion: (word: 'G0' | 'G1') => string;
  /** An axis word, `''` when a compact style may hold the current value. */
  readonly axis: (letter: 'X' | 'Y' | 'Z', value: number) => string;
  /** Formatted axis text the controller holds, for head-position checks. */
  readonly held: (letter: 'X' | 'Y' | 'Z') => string | undefined;
  /** Forget the modal state — after anything that may re-select a mode. */
  readonly reset: () => void;
};

export function createModalMotionWriter(style: MotionWordStyle): ModalMotionWriter {
  let motionWord: string | null = null;
  const axes = new Map<string, string>();
  return {
    motion: (word) => {
      const repeated = style.modalMotion && motionWord === word;
      motionWord = word;
      return repeated ? '' : word;
    },
    axis: (letter, value) => {
      const text = formatMotionCoordinateMm(value, style);
      const repeated = style.modalAxes && axes.get(letter) === text;
      axes.set(letter, text);
      return repeated ? '' : `${letter}${text}`;
    },
    held: (letter) => axes.get(letter),
    reset: () => {
      motionWord = null;
      axes.clear();
    },
  };
}
