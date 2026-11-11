// Moshiboard command-byte swizzle (ADR-705). A Moshiboard reads the high
// nibble of a command byte after a fixed bit permutation, which differs for odd
// and even bytes; Moshi's own software picks among 16 equivalent bytes per
// command at random and the board reads them all the same. Reimplemented from
// MeerK40t (MIT) meerk40t/moshi/builder.py at d511944e: `_swizzle` and
// `convert` L755-779, `reconvert` L782-788, the command numbers L300-317 and
// the swizzle_table L9-298, whose row r column c is the byte that converts to
// r * 16 + c (moshi-swizzle.test.ts pins that and MeerK40t's own entries).
// Simulator-tested only, not qualified on hardware.

/** Program commands (builder.py L300-309): the high nibble after `convert`. */
export const MOSHI_SET_OFFSET = 0;
export const MOSHI_TERMINATION = 2;
export const MOSHI_MOVE_VERT = 3;
export const MOSHI_RASTER_SPEED = 4;
export const MOSHI_VECTOR_SPEED = 5;
export const MOSHI_MOVE_HORIZ = 6;
export const MOSHI_MOVE_ABS = 7;
export const MOSHI_CUT_VERT = 11;
export const MOSHI_CUT_HORIZ = 14;
export const MOSHI_CUT_ABS = 15;

/** Realtime commands sent as EPP address writes (builder.py L311-317). The
 *  estop and the free-motor command are the same byte (both 1). */
export const MOSHI_ESTOP = 1;
export const MOSHI_EPILOGUE = 2;
export const MOSHI_PROLOGUE = 6;

// `_swizzle(b, p7..p0)` moves bit i of b to position p_i. Odd bytes use
// (7, 6, 2, 4, 3, 5, 1, 0), even bytes (5, 1, 7, 2, 4, 3, 6, 0); the arrays
// below list p0..p7.
const ODD_BIT_TARGETS = [0, 1, 5, 3, 4, 2, 6, 7] as const;
const EVEN_BIT_TARGETS = [0, 6, 3, 4, 2, 7, 1, 5] as const;

function permuteBits(value: number, targets: ReadonlyArray<number>): number {
  let out = 0;
  for (let bit = 0; bit < 8; bit += 1) {
    if ((value >> bit) & 1) out |= 1 << (targets[bit] ?? bit);
  }
  return out;
}

/** The value a Moshiboard reads from a sent byte (MeerK40t `convert`). */
export function moshiConvert(byte: number): number {
  const value = byte & 0xff;
  return permuteBits(value, value & 1 ? ODD_BIT_TARGETS : EVEN_BIT_TARGETS);
}

/** The byte that converts to `value`: the inverse permutation, which is what
 *  MeerK40t's `reconvert` (five more applications of `convert`) computes. */
export function moshiReconvert(value: number): number {
  let byte = value & 0xff;
  for (let i = 0; i < 5; i += 1) byte = moshiConvert(byte);
  return byte;
}

/** Row `command`, column `variant` of MeerK40t's swizzle_table. */
export function moshiCommandByte(command: number, variant = 0): number {
  return moshiReconvert(((command & 0x0f) << 4) | (variant & 0x0f));
}

/** The command a sent byte carries (MeerK40t `debug`: convert(b) >> 4). */
export function moshiCommandOf(byte: number): number {
  return moshiConvert(byte) >> 4;
}
