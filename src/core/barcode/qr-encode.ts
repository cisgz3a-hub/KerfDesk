// QR Code model 2 encoder: picks the smallest version (1-40) that holds the
// text at the requested error-correction level, builds the codeword sequence
// (segments, terminator, pad bytes, per-block Reed-Solomon, interleaving),
// places it and applies the lowest-penalty mask.

import { QR_FIELD, reedSolomonGenerator, reedSolomonRemainder } from './reed-solomon';
import { applyQrMask, qrPenalty } from './qr-mask';
import { drawFormatBits, placeQrCodewords, qrFormatBits, qrFunctionGrid } from './qr-matrix';
import {
  appendBits,
  appendQrSegmentBits,
  qrCountBits,
  qrSegmentBits,
  qrSegmentsFor,
  type QrSegment,
} from './qr-segments';
import {
  QR_ERROR_CORRECTION_BITS,
  QR_MAX_VERSION,
  QR_MIN_VERSION,
  qrBlockLayout,
  type QrErrorCorrection,
} from './qr-tables';

export type QrSymbol = {
  readonly version: number;
  readonly errorCorrection: QrErrorCorrection;
  readonly mask: number;
  readonly size: number;
  /** Row-major, 1 = dark. */
  readonly modules: Uint8Array;
};

export type QrEncodeResult =
  | { readonly ok: true; readonly symbol: QrSymbol }
  | { readonly ok: false; readonly message: string };

export type QrEncodeOptions = {
  readonly errorCorrection: QrErrorCorrection;
  /** Test and reproduction hook; the encoder chooses the mask when absent. */
  readonly mask?: number;
};

export function encodeQr(text: string, options: QrEncodeOptions): QrEncodeResult {
  const fit = smallestFit(text, options.errorCorrection);
  if (fit === null) {
    return {
      ok: false,
      message: `Too much data for a QR Code at error correction ${options.errorCorrection}. Shorten the text or choose a lower level.`,
    };
  }
  const codewords = qrCodewords(fit.segments, fit.version, options.errorCorrection);
  return { ok: true, symbol: buildSymbol(codewords, fit.version, options) };
}

type Fit = { readonly version: number; readonly segments: readonly QrSegment[] };

function smallestFit(text: string, level: QrErrorCorrection): Fit | null {
  // One segmentation per character-count width group; versions inside a
  // group share it, so each group is solved once.
  let segments: readonly QrSegment[] = [];
  for (let version = QR_MIN_VERSION; version <= QR_MAX_VERSION; version += 1) {
    if (version === 1 || version === 10 || version === 27) segments = qrSegmentsFor(text, version);
    if (fitsVersion(segments, version, level)) return { version, segments };
  }
  return null;
}

function fitsVersion(
  segments: readonly QrSegment[],
  version: number,
  level: QrErrorCorrection,
): boolean {
  let bits = 0;
  for (const segment of segments) {
    if (segment.values.length >= 2 ** qrCountBits(segment.mode, version)) return false;
    bits += qrSegmentBits(segment, version);
  }
  return bits <= qrBlockLayout(version, level).dataCodewords * 8;
}

/** Final interleaved data and error-correction codewords for one symbol. */
export function qrCodewords(
  segments: readonly QrSegment[],
  version: number,
  level: QrErrorCorrection,
): Uint8Array {
  const data = qrDataCodewords(segments, version, level);
  return interleaveQrBlocks(data, version, level);
}

export function qrDataCodewords(
  segments: readonly QrSegment[],
  version: number,
  level: QrErrorCorrection,
): Uint8Array {
  const capacityBits = qrBlockLayout(version, level).dataCodewords * 8;
  const bits: number[] = [];
  for (const segment of segments) appendQrSegmentBits(bits, segment, version);
  appendBits(bits, 0, Math.min(4, capacityBits - bits.length));
  appendBits(bits, 0, (8 - (bits.length % 8)) % 8);
  const bytes = new Uint8Array(capacityBits / 8);
  for (let index = 0; index < bits.length; index += 1) {
    bytes[index >>> 3] = (bytes[index >>> 3] ?? 0) | ((bits[index] ?? 0) << (7 - (index & 7)));
  }
  for (let index = bits.length / 8, pad = 0; index < bytes.length; index += 1, pad += 1) {
    bytes[index] = pad % 2 === 0 ? 0xec : 0x11;
  }
  return bytes;
}

/** Splits data codewords into blocks, appends each block's check codewords and interleaves. */
export function interleaveQrBlocks(
  data: Uint8Array,
  version: number,
  level: QrErrorCorrection,
): Uint8Array {
  const layout = qrBlockLayout(version, level);
  const shortBlocks = layout.blocks - (layout.totalCodewords % layout.blocks);
  const shortDataLength = Math.floor(layout.totalCodewords / layout.blocks) - layout.eccPerBlock;
  const generator = reedSolomonGenerator(QR_FIELD, layout.eccPerBlock, 0);
  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let block = 0; block < layout.blocks; block += 1) {
    const length = shortDataLength + (block < shortBlocks ? 0 : 1);
    const blockData = data.subarray(offset, offset + length);
    offset += length;
    dataBlocks.push(blockData);
    eccBlocks.push(reedSolomonRemainder(QR_FIELD, blockData, generator));
  }
  const result: number[] = [];
  for (let index = 0; index <= shortDataLength; index += 1) {
    for (const block of dataBlocks) if (index < block.length) result.push(block[index] ?? 0);
  }
  for (let index = 0; index < layout.eccPerBlock; index += 1) {
    for (const block of eccBlocks) result.push(block[index] ?? 0);
  }
  return Uint8Array.from(result);
}

function buildSymbol(codewords: Uint8Array, version: number, options: QrEncodeOptions): QrSymbol {
  const base = qrFunctionGrid(version);
  placeQrCodewords(base, codewords);
  const candidates = options.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.mask];
  let best: { mask: number; modules: Uint8Array; penalty: number } | null = null;
  for (const mask of candidates) {
    const grid = { size: base.size, dark: base.dark.slice(), reserved: base.reserved };
    applyQrMask(grid, mask);
    drawFormatBits(grid, qrFormatBits(QR_ERROR_CORRECTION_BITS[options.errorCorrection], mask));
    const penalty = candidates.length === 1 ? 0 : qrPenalty(grid.dark, grid.size);
    if (best === null || penalty < best.penalty) best = { mask, modules: grid.dark, penalty };
  }
  const chosen = best ?? { mask: 0, modules: base.dark };
  return {
    version,
    errorCorrection: options.errorCorrection,
    mask: chosen.mask,
    size: base.size,
    modules: chosen.modules,
  };
}
