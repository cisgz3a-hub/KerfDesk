// font-collection — reads the few SFNT facts system-font embedding needs
// (ADR-628): whether bytes are a TrueType/OpenType collection, which face of a
// collection has a given PostScript name, a standalone copy of that one face,
// and whether the face's OS/2 fsType restricts embedding. Pure, no I/O.
//
// Layout follows the OpenType spec's "Font Collections" and "Table Directory":
// https://learn.microsoft.com/en-us/typography/opentype/spec/otff

const TTC_TAG = 0x74746366; // 'ttcf'
const HEAD_TAG = 0x68656164; // 'head'
const NAME_TAG = 0x6e616d65; // 'name'
const OS2_TAG = 0x4f532f32; // 'OS/2'
const TABLE_RECORD_BYTES = 16;
const SFNT_HEADER_BYTES = 12;
const HEAD_CHECKSUM_ADJUSTMENT_OFFSET = 8;
const CHECKSUM_MAGIC = 0xb1b0afba;
const POSTSCRIPT_NAME_ID = 6;
const FS_TYPE_OFFSET = 8;
const FS_TYPE_USAGE_MASK = 0x000f;
const FS_TYPE_RESTRICTED = 0x0002;
const FS_TYPE_PREVIEW_PRINT = 0x0004;
const FS_TYPE_EDITABLE = 0x0008;
const FS_TYPE_BITMAP_ONLY = 0x0200;
/** OS/2 versions 0 and 1 assign only fsType bits 0 to 3. */
const OS2_FIRST_VERSION_WITH_BITMAP_FLAG = 2;

type TableRecord = {
  readonly tag: number;
  readonly checksum: number;
  readonly offset: number;
  readonly length: number;
};

export function isFontCollection(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 && view(bytes).getUint32(0) === TTC_TAG;
}

/** Offsets of each face's table directory in a collection. */
function collectionFaceOffsets(bytes: Uint8Array): number[] {
  const data = view(bytes);
  const count = data.getUint32(8);
  if (count === 0 || 12 + count * 4 > bytes.byteLength) {
    throw new Error('Font collection is empty or truncated.');
  }
  return Array.from({ length: count }, (_, index) => data.getUint32(12 + index * 4));
}

function tableRecords(bytes: Uint8Array, directoryOffset: number): TableRecord[] {
  const data = view(bytes);
  if (directoryOffset + SFNT_HEADER_BYTES > bytes.byteLength) {
    throw new Error('Font table directory is truncated.');
  }
  const count = data.getUint16(directoryOffset + 4);
  const records: TableRecord[] = [];
  for (let index = 0; index < count; index++) {
    const at = directoryOffset + SFNT_HEADER_BYTES + index * TABLE_RECORD_BYTES;
    if (at + TABLE_RECORD_BYTES > bytes.byteLength)
      throw new Error('Font table list is truncated.');
    const record = {
      tag: data.getUint32(at),
      checksum: data.getUint32(at + 4),
      offset: data.getUint32(at + 8),
      length: data.getUint32(at + 12),
    };
    if (record.offset + record.length > bytes.byteLength) {
      throw new Error('Font table points past the end of the file.');
    }
    records.push(record);
  }
  return records;
}

/** The face's PostScript name (name ID 6), or null when it has none. */
function postscriptNameAt(bytes: Uint8Array, directoryOffset: number): string | null {
  const table = tableRecords(bytes, directoryOffset).find((record) => record.tag === NAME_TAG);
  if (table === undefined || table.length < 6) return null;
  const data = view(bytes);
  const count = data.getUint16(table.offset + 2);
  const strings = table.offset + data.getUint16(table.offset + 4);
  for (let index = 0; index < count; index++) {
    const at = table.offset + 6 + index * 12;
    if (at + 12 > table.offset + table.length) break;
    if (data.getUint16(at + 6) !== POSTSCRIPT_NAME_ID) continue;
    const platform = data.getUint16(at);
    const length = data.getUint16(at + 8);
    const start = strings + data.getUint16(at + 10);
    if (start + length > bytes.byteLength) continue;
    const raw = bytes.subarray(start, start + length);
    return platform === 1 ? latin1(raw) : utf16be(raw);
  }
  return null;
}

/** Index of the face named `postscriptName`; the only face, or null when absent. */
export function collectionFaceIndex(bytes: Uint8Array, postscriptName: string): number | null {
  const offsets = collectionFaceOffsets(bytes);
  const index = offsets.findIndex((offset) => postscriptNameAt(bytes, offset) === postscriptName);
  if (index >= 0) return index;
  return offsets.length === 1 ? 0 : null;
}

/** A standalone font file holding one collection face's tables, unchanged. */
export function extractCollectionFace(bytes: Uint8Array, faceIndex: number): ArrayBuffer {
  const directoryOffset = collectionFaceOffsets(bytes)[faceIndex];
  if (directoryOffset === undefined) throw new Error('That face is not in the font collection.');
  const records = tableRecords(bytes, directoryOffset);
  const directoryBytes = SFNT_HEADER_BYTES + records.length * TABLE_RECORD_BYTES;
  const placed = placeTables(records, directoryBytes);
  const output = new Uint8Array(placed.totalBytes);
  const data = new DataView(output.buffer);
  output.set(bytes.subarray(directoryOffset, directoryOffset + SFNT_HEADER_BYTES), 0);
  records.forEach((record, index) => {
    const at = SFNT_HEADER_BYTES + index * TABLE_RECORD_BYTES;
    const offset = placed.offsets[index] ?? 0;
    data.setUint32(at, record.tag);
    data.setUint32(at + 4, record.checksum);
    data.setUint32(at + 8, offset);
    data.setUint32(at + 12, record.length);
    output.set(bytes.subarray(record.offset, record.offset + record.length), offset);
  });
  rewriteHeadChecksumAdjustment(output, records, placed.offsets);
  return output.buffer;
}

function placeTables(
  records: ReadonlyArray<TableRecord>,
  start: number,
): { readonly offsets: number[]; readonly totalBytes: number } {
  const offsets: number[] = [];
  let next = start;
  for (const record of records) {
    offsets.push(next);
    next = align4(next + record.length);
  }
  return { offsets, totalBytes: next };
}

function rewriteHeadChecksumAdjustment(
  output: Uint8Array,
  records: ReadonlyArray<TableRecord>,
  offsets: ReadonlyArray<number>,
): void {
  const headIndex = records.findIndex((record) => record.tag === HEAD_TAG);
  const headOffset = offsets[headIndex];
  if (headIndex < 0 || headOffset === undefined) return;
  const data = new DataView(output.buffer);
  const at = headOffset + HEAD_CHECKSUM_ADJUSTMENT_OFFSET;
  if (at + 4 > output.byteLength) return;
  data.setUint32(at, 0);
  data.setUint32(at, (CHECKSUM_MAGIC - fontChecksum(output)) >>> 0);
}

/** The OpenType checksum: the uint32 sum of the bytes, zero-padded to 4. */
export function fontChecksum(bytes: Uint8Array): number {
  const padded = new Uint8Array(align4(bytes.byteLength));
  padded.set(bytes);
  const data = new DataView(padded.buffer);
  let sum = 0;
  for (let at = 0; at < padded.byteLength; at += 4) sum = (sum + data.getUint32(at)) >>> 0;
  return sum;
}

/** True when the face's OS/2 fsType limits embedding it in a project that can
 * be edited and shared: Restricted License, Preview & Print only, or bitmap
 * embedding only (a project embeds outlines). Installable and Editable faces
 * are not limited. When several usage bits are set, as some version 0 to 2
 * fonts do, the least restrictive applies (OpenType OS/2 fsType):
 * https://learn.microsoft.com/en-us/typography/opentype/spec/os2#fstype */
export function fontEmbeddingRestricted(bytes: Uint8Array): boolean {
  const directoryOffset = isFontCollection(bytes) ? (collectionFaceOffsets(bytes)[0] ?? 0) : 0;
  const os2 = tableRecords(bytes, directoryOffset).find((record) => record.tag === OS2_TAG);
  if (os2 === undefined || os2.length < FS_TYPE_OFFSET + 2) return false;
  const data = view(bytes);
  const fsType = data.getUint16(os2.offset + FS_TYPE_OFFSET);
  const version = data.getUint16(os2.offset);
  if (version >= OS2_FIRST_VERSION_WITH_BITMAP_FLAG && (fsType & FS_TYPE_BITMAP_ONLY) !== 0) {
    return true;
  }
  const usage = fsType & FS_TYPE_USAGE_MASK;
  if (usage === 0 || (usage & FS_TYPE_EDITABLE) !== 0) return false;
  return (usage & (FS_TYPE_RESTRICTED | FS_TYPE_PREVIEW_PRINT)) !== 0;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function utf16be(raw: Uint8Array): string {
  let text = '';
  for (let at = 0; at + 1 < raw.length; at += 2) {
    text += String.fromCharCode(((raw[at] ?? 0) << 8) | (raw[at + 1] ?? 0));
  }
  return text;
}

function latin1(raw: Uint8Array): string {
  return String.fromCharCode(...raw);
}
