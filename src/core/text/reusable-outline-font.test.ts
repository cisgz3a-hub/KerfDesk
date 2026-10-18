import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reusableOutlineFont } from './reusable-outline-font';

function bytes(path: string): ArrayBuffer {
  const buffer = readFileSync(resolve(__dirname, path));
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

const roboto = bytes('../../ui/text/fonts/Roboto-Regular.ttf');

// Renames the first table directory entry with `from` to `to`, in a copy.
function renameTable(font: ArrayBuffer, from: string, to: string): ArrayBuffer {
  const copy = font.slice(0);
  const view = new DataView(copy);
  for (let index = 0; index < view.getUint16(4); index += 1) {
    const record = 12 + index * 16;
    const tag = String.fromCharCode(...new Uint8Array(copy, record, 4));
    if (tag !== from) continue;
    for (let char = 0; char < 4; char += 1) view.setUint8(record + char, to.charCodeAt(char));
    return copy;
  }
  throw new Error(`no ${from} table`);
}

function withSignature(font: ArrayBuffer, signature: string): ArrayBuffer {
  const copy = font.slice(0);
  new Uint8Array(copy).set([...signature].map((char) => char.charCodeAt(0)));
  return copy;
}

// A minimal TrueType file with head, maxp, loca and glyf. Each glyph is either
// empty (a simple glyph with no contours) or composite over the given glyphs.
function syntheticFont(glyphs: ReadonlyArray<ReadonlyArray<number> | null>): ArrayBuffer {
  const glyphData = glyphs.map((components) => {
    if (components === null) return new Uint8Array(10);
    const data = new DataView(new ArrayBuffer(10 + components.length * 6));
    data.setInt16(0, -1);
    components.forEach((glyphIndex, index) => {
      const at = 10 + index * 6;
      const more = index < components.length - 1 ? 0x0020 : 0;
      data.setUint16(at, 0x0002 | more); // byte x/y offsets
      data.setUint16(at + 2, glyphIndex);
    });
    return new Uint8Array(data.buffer);
  });
  const glyf = new Uint8Array(glyphData.reduce((sum, data) => sum + data.length, 0));
  const loca = new DataView(new ArrayBuffer((glyphs.length + 1) * 4));
  let offset = 0;
  glyphData.forEach((data, index) => {
    loca.setUint32(index * 4, offset);
    glyf.set(data, offset);
    offset += data.length;
  });
  loca.setUint32(glyphs.length * 4, offset);
  const head = new DataView(new ArrayBuffer(54));
  head.setInt16(50, 1); // long loca offsets
  const maxp = new DataView(new ArrayBuffer(6));
  maxp.setUint16(4, glyphs.length);
  const tables: Array<[string, Uint8Array]> = [
    ['glyf', glyf],
    ['head', new Uint8Array(head.buffer)],
    ['loca', new Uint8Array(loca.buffer)],
    ['maxp', new Uint8Array(maxp.buffer)],
  ];
  const directory = 12 + tables.length * 16;
  const size = tables.reduce((sum, [, data]) => sum + data.length, directory);
  const file = new Uint8Array(size);
  const view = new DataView(file.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, tables.length);
  let cursor = directory;
  tables.forEach(([tag, data], index) => {
    const record = 12 + index * 16;
    file.set(
      [...tag].map((char) => char.charCodeAt(0)),
      record,
    );
    view.setUint32(record + 8, cursor);
    view.setUint32(record + 12, data.length);
    file.set(data, cursor);
    cursor += data.length;
  });
  return file.buffer;
}

describe('reusableOutlineFont (ADR-624)', () => {
  it.each([
    '../../ui/text/fonts/Roboto-Regular.ttf',
    '../../ui/text/fonts/GreatVibes-Regular.ttf',
    '../../ui/text/fonts/Tinos-Regular.ttf',
    '__fixtures__/NotoSansArabic-Regular.ttf',
  ])('reuses the plain TrueType font %s', (path) => {
    expect(reusableOutlineFont(bytes(path))).toBe(true);
  });

  it('parses the variable bundled Dancing Script for every render', () => {
    expect(reusableOutlineFont(bytes('../../ui/text/fonts/DancingScript-Regular.ttf'))).toBe(false);
  });

  it.each(['SVG ', 'COLR', 'fvar', 'CFF ', 'CFF2'])(
    'never reuses a font with a %s table',
    (tag) => {
      expect(reusableOutlineFont(renameTable(roboto, 'post', tag))).toBe(false);
    },
  );

  it.each(['OTTO', 'wOFF', 'wOF2', 'ttcf'])('never reuses a %s file', (signature) => {
    expect(reusableOutlineFont(withSignature(roboto, signature))).toBe(false);
  });

  it('never reuses a truncated or empty file', () => {
    expect(reusableOutlineFont(roboto.slice(0, roboto.byteLength / 2))).toBe(false);
    expect(reusableOutlineFont(new ArrayBuffer(0))).toBe(false);
  });

  it('reuses composite glyphs that form no cycle', () => {
    expect(reusableOutlineFont(syntheticFont([null, [0], [1, 0], [2, 1]]))).toBe(true);
  });

  it.each([
    ['two glyphs that include each other', [null, [2], [1]]],
    ['a longer cycle', [null, [2], [3], [0, 1]]],
    ['a glyph that includes itself', [null, [1]]],
    ['a component that does not exist', [null, [7]]],
  ])('never reuses %s', (_name, glyphs) => {
    expect(reusableOutlineFont(syntheticFont(glyphs))).toBe(false);
  });
});
