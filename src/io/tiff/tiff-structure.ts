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
