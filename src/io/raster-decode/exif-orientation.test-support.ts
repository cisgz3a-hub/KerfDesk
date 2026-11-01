// Synthetic EXIF TIFF blocks and PNG files for the Orientation readers' tests,
// shaped like the files the Chromium measurements in exif-orientation.ts used.

import { finishPngCrc, startPngCrc, updatePngCrc } from './png-crc';

export type ExifEntry = {
  readonly value: number;
  /** TIFF type; 3 (SHORT) is the only one Chromium reads. */
  readonly type?: number;
  readonly count?: number;
};

export type ExifBlockOptions = {
  readonly byteOrder?: 'II' | 'MM';
  /** Orientation entries of IFD0, in order; a Make entry precedes them. */
  readonly ifd0?: ReadonlyArray<ExifEntry>;
  /** Orientation entries of an Exif sub-IFD that IFD0 points to (tag 0x8769). */
  readonly subIfd?: ReadonlyArray<ExifEntry>;
};

/** A TIFF-structured EXIF block, as a PNG eXIf chunk holds it. */
export function exifTiffBlock(options: ExifBlockOptions): number[] {
  const little = (options.byteOrder ?? 'MM') === 'II';
  const u16 = (value: number): number[] =>
    little ? [value & 0xff, (value >>> 8) & 0xff] : [(value >>> 8) & 0xff, value & 0xff];
  const u32 = (value: number): number[] => {
    const bytes = [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ];
    return little ? bytes.reverse() : bytes;
  };
  const orientation = (entry: ExifEntry): number[] => [
    ...u16(0x0112),
    ...u16(entry.type ?? 3),
    ...u32(entry.count ?? 1),
    ...u16(entry.value),
    0,
    0,
  ];
  const ifd0 = options.ifd0 ?? [];
  const sub = options.subIfd;
  const ifd0Entries = 1 + ifd0.length + (sub === undefined ? 0 : 1);
  const subOffset = 8 + 2 + ifd0Entries * 12 + 4;
  const make = [...u16(0x010f), ...u16(2), ...u32(4), 0x43, 0x61, 0x6d, 0];
  const pointer =
    sub === undefined ? [] : [...u16(0x8769), ...u16(4), ...u32(1), ...u32(subOffset)];
  const header = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8)];
  const first = [...u16(ifd0Entries), ...make, ...ifd0.flatMap(orientation), ...pointer, ...u32(0)];
  const second =
    sub === undefined ? [] : [...u16(sub.length), ...sub.flatMap(orientation), ...u32(0)];
  return [...header, ...first, ...second];
}

export type PngChunk = { readonly type: string; readonly data: ReadonlyArray<number> };

/** A PNG chunk with its length and a matching CRC, or a broken one. */
export function pngChunk(chunk: PngChunk, brokenCrc = false): number[] {
  const type = Uint8Array.from(chunk.type, (char) => char.charCodeAt(0));
  const data = Uint8Array.from(chunk.data);
  const crc = finishPngCrc(updatePngCrc(startPngCrc(type), data)) ^ (brokenCrc ? 1 : 0);
  return [...be32(data.length), ...type, ...data, ...be32(crc >>> 0)];
}

export type SyntheticPngOptions = {
  readonly width: number;
  readonly height: number;
  /** Chunk bytes between IHDR and IDAT. */
  readonly beforeIdat?: ReadonlyArray<ReadonlyArray<number>>;
  /** Chunk bytes between IDAT and IEND. */
  readonly afterIdat?: ReadonlyArray<ReadonlyArray<number>>;
};

/** PNG bytes for header readers: its IDAT holds no decodable image. */
export function syntheticPngBytes(options: SyntheticPngOptions): Uint8Array<ArrayBuffer> {
  const ihdr = [...be32(options.width), ...be32(options.height), 8, 2, 0, 0, 0];
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk({ type: 'IHDR', data: ihdr }),
    ...(options.beforeIdat ?? []).flat(),
    ...pngChunk({ type: 'IDAT', data: [0x78, 0x01] }),
    ...(options.afterIdat ?? []).flat(),
    ...pngChunk({ type: 'IEND', data: [] }),
  ]);
}

/** An eXIf chunk whose IFD0 holds one Orientation. */
export function exifChunk(orientation: number, byteOrder: 'II' | 'MM' = 'MM'): number[] {
  return pngChunk({
    type: 'eXIf',
    data: exifTiffBlock({ byteOrder, ifd0: [{ value: orientation }] }),
  });
}

/** A pHYs chunk in pixels per metre. */
export function physChunk(xPerMetre: number, yPerMetre: number): number[] {
  return pngChunk({ type: 'pHYs', data: [...be32(xPerMetre), ...be32(yPerMetre), 1] });
}

function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
