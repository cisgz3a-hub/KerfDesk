import type { TiffIfd } from 'tiff';
import { decompressedBlockLength, TIFF_DATA_INCOMPLETE } from './tiff-decompressed-length';

type PixelLayout = {
  readonly offsets: unknown;
  readonly byteCounts: unknown;
  readonly count: number;
  /** The bytes the decoder reads from each block. */
  readonly blockBytes: (index: number) => number;
  /** The most any block may hold: a whole tile, or a strip of RowsPerStrip rows. */
  readonly fullBlockBytes: number;
};

/** Qualify the blocks the decoder will read before it allocates image data. */
export function validateTiffPixelLayout(page: TiffIfd, bytes: Uint8Array): void {
  if ((page.get('FillOrder') ?? 1) !== 1) {
    throw new Error('Export this TIFF with most-significant-bit-first samples or as PNG.');
  }
  const hasTiles = [322, 323, 324, 325].some((tag) => page.fields.has(tag));
  const layout = hasTiles ? tileLayout(page) : stripLayout(page);
  const offsets = blockValues(layout.offsets, layout.count, 'offsets', 8);
  const byteCounts = blockValues(layout.byteCounts, layout.count, 'byte counts', 1);
  for (let index = 0; index < layout.count; index += 1) {
    const offset = offsets[index] ?? bytes.byteLength;
    const count = byteCounts[index] ?? 0;
    if (offset + count > bytes.byteLength) {
      throw new Error('TIFF pixel data extends beyond the file.');
    }
    if (page.compression === 1 && count < layout.blockBytes(index)) {
      throw new Error('Incomplete uncompressed TIFF pixel data.');
    }
  }
  if (page.compression !== 1) {
    const blocks = offsets.map((offset, index) =>
      bytes.subarray(offset, offset + (byteCounts[index] ?? 0)),
    );
    validateDecompressedBlocks(blocks, page.compression, layout);
  }
}

// A compressed block decompresses to its rows or tile, never past a full one.
function validateDecompressedBlocks(
  blocks: readonly Uint8Array[],
  compression: number,
  layout: PixelLayout,
): void {
  blocks.forEach((block, index) => {
    const length = decompressedBlockLength(block, compression, layout.fullBlockBytes);
    if (length < layout.blockBytes(index)) throw new Error(TIFF_DATA_INCOMPLETE);
  });
}

// A last strip may hold all RowsPerStrip rows, the image's and padding.
function stripLayout(page: TiffIfd): PixelLayout {
  const rows = positiveInteger(page.get('RowsPerStrip') ?? 2 ** 32 - 1, 'rows per strip');
  const rowBytes = Math.ceil((page.width * page.components * page.bitsPerSample) / 8);
  return {
    offsets: page.stripOffsets,
    byteCounts: page.stripByteCounts,
    count: Math.ceil(page.height / rows),
    blockBytes: (index) => rowBytes * Math.min(rows, page.height - index * rows),
    fullBlockBytes: rowBytes * Math.min(rows, page.height),
  };
}

function tileLayout(page: TiffIfd): PixelLayout {
  if (page.components !== 1) {
    throw new Error('Export tiled RGB or alpha TIFF as strips or PNG before importing.');
  }
  const width = positiveInteger(page.tileWidth, 'tile width');
  const height = positiveInteger(page.tileHeight, 'tile height');
  // The decoder reconstructs horizontal differences after joining tiles, so
  // the first sample of a later tile would inherit the previous tile's value.
  if (page.predictor === 2 && width < page.width) {
    throw new Error('Export this TIFF without tile prediction, as strips, or as PNG.');
  }
  if (page.bitsPerSample === 1 && width % 8 !== 0) {
    throw new Error('Export this bilevel TIFF with byte-aligned tiles or as PNG.');
  }
  const bytes = Math.ceil((width * page.bitsPerSample) / 8) * height;
  return {
    offsets: page.tileOffsets,
    byteCounts: page.tileByteCounts,
    count: Math.ceil(page.width / width) * Math.ceil(page.height / height),
    blockBytes: () => bytes,
    fullBlockBytes: bytes,
  };
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Invalid TIFF ' + label + '.');
  }
  return value;
}

function blockValues(value: unknown, count: number, label: string, minimum: number): number[] {
  const values =
    ArrayBuffer.isView(value) && !(value instanceof DataView)
      ? Array.from(value as unknown as ArrayLike<unknown>)
      : value;
  if (
    !Array.isArray(values) ||
    values.length !== count ||
    values.some(
      (item: unknown) => typeof item !== 'number' || !Number.isSafeInteger(item) || item < minimum,
    )
  ) {
    throw new Error('TIFF requires complete strip or tile ' + label + ' for every image row.');
  }
  return values as number[];
}
