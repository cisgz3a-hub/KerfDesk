type TiffFixturePage = {
  readonly width?: number;
  readonly height?: number;
  readonly pixels?: readonly number[];
  readonly orientation?: number;
  readonly bits?: number;
  readonly type?: number;
  readonly components?: number;
  readonly alpha?: number;
  readonly xDpi?: number;
  readonly yDpi?: number;
  readonly compression?: number;
  readonly rowsPerStrip?: number;
  readonly blocks?: readonly (readonly number[])[];
  readonly tileSize?: readonly [number, number];
  readonly fillOrder?: number;
  readonly predictor?: number;
  readonly sampleFormat?: number | readonly number[];
};
type Entry = { tag: number; type: number; values: number[] };

/** Small independently encoded, uncompressed classic TIFF pages. */
export function tiffDocument(
  pages: readonly TiffFixturePage[],
  little = true,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(16384);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, little ? 0x4949 : 0x4d4d);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  let cursor = 8;
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i] ?? {};
    const entries = pageEntries(page);
    view.setUint16(cursor, entries.length, little);
    const nextPointer = cursor + 2 + entries.length * 12;
    let dataOffset = nextPointer + 4;
    for (let j = 0; j < entries.length; j += 1) {
      const entry = entries[j];
      if (entry === undefined) continue;
      const entryOffset = cursor + 2 + j * 12;
      const unit = entry.type === 3 ? 2 : 4;
      const length = entry.values.length * unit;
      view.setUint16(entryOffset, entry.tag, little);
      view.setUint16(entryOffset + 2, entry.type, little);
      view.setUint32(entryOffset + 4, entry.type === 5 ? 1 : entry.values.length, little);
      const offset = length > 4 ? dataOffset : entryOffset + 8;
      if (length > 4) {
        view.setUint32(entryOffset + 8, dataOffset, little);
        dataOffset += length;
      }
      entry.values.forEach((value, index) => {
        if (unit === 2) view.setUint16(offset + index * unit, value, little);
        else view.setUint32(offset + index * unit, value, little);
      });
    }
    dataOffset = writePixelBlocks(page, entries, view, cursor, dataOffset, little);
    cursor = dataOffset + (dataOffset % 2);
    view.setUint32(nextPointer, i + 1 < pages.length ? cursor : 0, little);
  }
  return bytes.slice(0, cursor);
}

function pageEntries(page: TiffFixturePage): Entry[] {
  const width = page.width ?? 2;
  const height = page.height ?? 3;
  const components = page.components ?? 1;
  const entries: Entry[] = [
    { tag: 256, type: 4, values: [width] },
    { tag: 257, type: 4, values: [height] },
    { tag: 258, type: 3, values: Array.from({ length: components }, () => page.bits ?? 8) },
    { tag: 259, type: 3, values: [page.compression ?? 1] },
    { tag: 262, type: 3, values: [page.type ?? 1] },
    { tag: 274, type: 3, values: [page.orientation ?? 1] },
    { tag: 277, type: 3, values: [components] },
    ...storageEntries(page, height),
    { tag: 282, type: 5, values: [page.xDpi ?? 100, 1] },
    { tag: 283, type: 5, values: [page.yDpi ?? 200, 1] },
    { tag: 296, type: 3, values: [2] },
  ];
  return [...entries, ...optionalEntries(page)].sort((a, b) => a.tag - b.tag);
}

function optionalEntries(page: TiffFixturePage): Entry[] {
  const fields: Array<[number, number | readonly number[] | undefined]> = [
    [266, page.fillOrder],
    [317, page.predictor],
    [338, page.alpha],
    [339, page.sampleFormat],
  ];
  return fields.flatMap(([tag, value]) => {
    if (value === undefined) return [];
    return [{ tag, type: 3, values: typeof value === 'number' ? [value] : [...value] }];
  });
}

function pixelBlocks(page: TiffFixturePage): readonly (readonly number[])[] {
  return page.blocks ?? [page.pixels ?? [0, 50, 100, 150, 200, 250]];
}

function storageEntries(page: TiffFixturePage, height: number): Entry[] {
  const blocks = pixelBlocks(page);
  const offsets = { type: 4, values: blocks.map(() => 0) };
  const counts = {
    type: 4,
    values: blocks.map((block) => block.length * (page.bits === 16 ? 2 : 1)),
  };
  return page.tileSize === undefined
    ? [
        { tag: 273, ...offsets },
        { tag: 278, type: 4, values: [page.rowsPerStrip ?? height] },
        { tag: 279, ...counts },
      ]
    : [
        { tag: 322, type: 4, values: [page.tileSize[0]] },
        { tag: 323, type: 4, values: [page.tileSize[1]] },
        { tag: 324, ...offsets },
        { tag: 325, ...counts },
      ];
}

function writePixelBlocks(
  page: TiffFixturePage,
  entries: readonly Entry[],
  view: DataView,
  directory: number,
  start: number,
  little: boolean,
): number {
  const blocks = pixelBlocks(page);
  const index = entries.findIndex((entry) => entry.tag === 273 || entry.tag === 324);
  const value = directory + 2 + index * 12 + 8;
  const offsets = blocks.length > 1 ? view.getUint32(value, little) : value;
  let cursor = start;
  blocks.forEach((block, blockIndex) => {
    view.setUint32(offsets + blockIndex * 4, cursor, little);
    for (const sample of block) {
      if (page.bits === 16) {
        view.setUint16(cursor, sample, little);
        cursor += 2;
      } else {
        view.setUint8(cursor, sample);
        cursor += 1;
      }
    }
  });
  return cursor;
}
