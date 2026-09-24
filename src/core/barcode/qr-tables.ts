// QR Code model 2 constants from ISO/IEC 18004: symbol size, raw module
// count, error-correction block structure and alignment-pattern centres for
// versions 1-40. The block tables are indexed by version (index 0 unused).

export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';

export const QR_MIN_VERSION = 1;
export const QR_MAX_VERSION = 40;

// prettier-ignore
const ECC_CODEWORDS_PER_BLOCK: Readonly<Record<QrErrorCorrection, readonly number[]>> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

// prettier-ignore
const ERROR_CORRECTION_BLOCKS: Readonly<Record<QrErrorCorrection, readonly number[]>> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

// Two-bit error-correction indicator in the format information.
export const QR_ERROR_CORRECTION_BITS: Readonly<Record<QrErrorCorrection, number>> = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2,
};

export type QrBlockLayout = {
  readonly eccPerBlock: number;
  readonly blocks: number;
  readonly totalCodewords: number;
  readonly dataCodewords: number;
};

export function qrSize(version: number): number {
  return version * 4 + 17;
}

/** Modules left for data and error correction once every function pattern is placed. */
export function qrRawDataModules(version: number): number {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignments = Math.floor(version / 7) + 2;
    modules -= (25 * alignments - 10) * alignments - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

export function qrBlockLayout(version: number, level: QrErrorCorrection): QrBlockLayout {
  const eccPerBlock = ECC_CODEWORDS_PER_BLOCK[level][version] ?? 0;
  const blocks = ERROR_CORRECTION_BLOCKS[level][version] ?? 0;
  const totalCodewords = Math.floor(qrRawDataModules(version) / 8);
  return {
    eccPerBlock,
    blocks,
    totalCodewords,
    dataCodewords: totalCodewords - eccPerBlock * blocks,
  };
}

/** Row/column centres of the alignment patterns (ISO/IEC 18004 Annex E). */
export function qrAlignmentCentres(version: number): readonly number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const centres = [6];
  for (let position = qrSize(version) - 7; centres.length < count; position -= step) {
    centres.splice(1, 0, position);
  }
  return centres;
}
