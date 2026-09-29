// Validate classic TIFF directories before the decoder follows offsets. This
// bounds metadata reads by the actual file and rejects cyclic IFD/EXIF chains.
export function tiffPageCount(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8) throw new Error('Incomplete TIFF header.');
  const byteOrder = view.getUint16(0);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) throw new Error('Invalid TIFF byte order.');
  const little = byteOrder === 0x4949;
  if (view.getUint16(2, little) !== 42) {
    throw new Error(
      'Only classic TIFF files are supported. Export BigTIFF as PNG or classic TIFF.',
    );
  }
  const visited = new Set<number>();
  let offset = view.getUint32(4, little);
  let pages = 0;
  while (offset !== 0) {
    offset = visitDirectory(view, little, offset, visited);
    pages += 1;
  }
  if (pages === 0) throw new Error('This TIFF has no image pages.');
  return pages;
}

const TYPE_BYTES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];

function visitDirectory(
  view: DataView,
  little: boolean,
  offset: number,
  visited: Set<number>,
): number {
  if (visited.has(offset)) throw new Error('TIFF contains a cyclic image directory.');
  if (offset < 8 || offset + 2 > view.byteLength) throw new Error('Invalid TIFF directory offset.');
  visited.add(offset);
  const count = view.getUint16(offset, little);
  const end = offset + 2 + count * 12;
  if (end + 4 > view.byteLength) throw new Error('Incomplete TIFF image directory.');
  for (let i = 0; i < count; i += 1) {
    const entry = offset + 2 + i * 12;
    validateEntry(view, little, entry, visited);
  }
  return view.getUint32(end, little);
}

function validateEntry(view: DataView, little: boolean, entry: number, visited: Set<number>): void {
  const type = view.getUint16(entry + 2, little);
  const size = TYPE_BYTES[type];
  if (size === undefined || size === 0) throw new Error('Unsupported TIFF metadata type.');
  const count = view.getUint32(entry + 4, little);
  const length = count * size;
  const data = length > 4 ? view.getUint32(entry + 8, little) : entry + 8;
  if (data + length > view.byteLength) throw new Error('TIFF metadata extends beyond the file.');
  const tag = view.getUint16(entry, little);
  if (tag === 34665 || tag === 34853) {
    if (type !== 4 || count !== 1) throw new Error('Invalid TIFF EXIF directory.');
    // EXIF/GPS pointers can form a graph. Bound the call depth independently
    // of file size instead of letting a valid-size chain exhaust the stack.
    if (visited.size > 256) throw new Error('TIFF metadata nesting is too deep to read.');
    visitDirectory(view, little, view.getUint32(data, little), visited);
  }
}

const BITS_PER_SAMPLE_TAG = 258;
const SHORT_TYPE = 3;
const ENTRY_BYTES = 12;

/**
 * TIFF 6.0 gives BitsPerSample a default of 1 and lets bilevel files omit it
 * (Pillow's uncompressed 1-bit writer does), but the decoder has no default and
 * reads such a page as having no bit depth. Return a copy whose selected page
 * states the default, or the bytes themselves when the page already has it.
 */
export function withDefaultBitsPerSample(bytes: Uint8Array, pageNumber: number): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = view.getUint16(0) === 0x4949;
  const pointer = directoryPointer(view, little, pageNumber);
  const entries = view.getUint32(pointer, little) + 2;
  const count = view.getUint16(entries - 2, little);
  const tags = Array.from({ length: count }, (_, i) =>
    view.getUint16(entries + i * ENTRY_BYTES, little),
  );
  if (tags.includes(BITS_PER_SAMPLE_TAG)) return bytes;
  // Append the directory again with the entry in tag order and point the chain
  // at the copy. Values stored elsewhere keep their absolute offsets.
  const start = bytes.length + (bytes.length % 2); // directories start on a word boundary
  const out = new Uint8Array(start + 2 + (count + 1) * ENTRY_BYTES + 4);
  out.set(bytes);
  const outView = new DataView(out.buffer);
  const before = tags.filter((tag) => tag < BITS_PER_SAMPLE_TAG).length * ENTRY_BYTES;
  const added = start + 2 + before;
  outView.setUint16(start, count + 1, little);
  out.set(bytes.subarray(entries, entries + before), start + 2);
  outView.setUint16(added, BITS_PER_SAMPLE_TAG, little);
  outView.setUint16(added + 2, SHORT_TYPE, little);
  outView.setUint32(added + 4, 1, little);
  outView.setUint16(added + 8, 1, little);
  // The rest of the entries, then the next-directory pointer that follows them.
  out.set(bytes.subarray(entries + before, entries + count * ENTRY_BYTES + 4), added + ENTRY_BYTES);
  outView.setUint32(pointer, start, little);
  return out;
}

/** The byte offset of the pointer to page `pageNumber`'s directory. */
function directoryPointer(view: DataView, little: boolean, pageNumber: number): number {
  let pointer = 4;
  for (let page = 1; page < pageNumber; page += 1) {
    const directory = view.getUint32(pointer, little);
    pointer = directory + 2 + view.getUint16(directory, little) * ENTRY_BYTES;
  }
  return pointer;
}

/** The decoder accepts top-left samples only; orient our decoded pixels once. */
export function topLeftTiffBytes(bytes: Uint8Array, pageNumber: number): Uint8Array {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  const little = view.getUint16(0) === 0x4949;
  let offset = view.getUint32(4, little);
  for (let page = 1; page < pageNumber; page += 1) {
    offset = view.getUint32(offset + 2 + view.getUint16(offset, little) * 12, little);
  }
  const count = view.getUint16(offset, little);
  for (let index = 0; index < count; index += 1) {
    const entry = offset + 2 + index * 12;
    if (view.getUint16(entry, little) !== 274) continue;
    if (view.getUint16(entry + 2, little) === 3) view.setUint16(entry + 8, 1, little);
    else view.setUint32(entry + 8, 1, little);
  }
  return copy;
}
