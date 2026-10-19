import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'opentype.js';
import { describe, expect, it } from 'vitest';
import {
  collectionFaceIndex,
  extractCollectionFace,
  fontChecksum,
  fontEmbeddingRestricted,
  isFontCollection,
} from './font-collection';

function bundledFont(fileName: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(__dirname, '../../ui/text/fonts', fileName)));
}

// A real collection layout built from two bundled fonts: the 'ttcf' header,
// then each font's directory and tables, with table offsets measured from the
// start of the collection as the spec requires.
function collectionOf(fonts: ReadonlyArray<Uint8Array>): Uint8Array {
  const headerBytes = 12 + fonts.length * 4;
  const starts: number[] = [];
  let next = headerBytes;
  for (const font of fonts) {
    starts.push(next);
    next = (next + font.byteLength + 3) & ~3;
  }
  const output = new Uint8Array(next);
  const data = new DataView(output.buffer);
  data.setUint32(0, 0x74746366);
  data.setUint16(4, 1);
  data.setUint32(8, fonts.length);
  fonts.forEach((font, index) => {
    const start = starts[index] ?? 0;
    data.setUint32(12 + index * 4, start);
    output.set(font, start);
    const tables = data.getUint16(start + 4);
    for (let table = 0; table < tables; table++) {
      const at = start + 12 + table * 16 + 8;
      data.setUint32(at, data.getUint32(at) + start);
    }
  });
  return output;
}

// opentype.js 2 groups names by platform; these fonts carry Windows names.
function postscriptName(buffer: ArrayBuffer): string | undefined {
  const names = parse(buffer).names as unknown as {
    readonly windows?: { readonly postScriptName?: Readonly<Record<string, string>> };
  };
  return names.windows?.postScriptName?.['en'];
}

describe('font collections (ADR-628)', () => {
  const roboto = bundledFont('Roboto-Regular.ttf');
  const tinos = bundledFont('Tinos-Bold.ttf');
  const collection = collectionOf([roboto, tinos]);

  it('recognises a collection and leaves a single font alone', () => {
    expect(isFontCollection(collection)).toBe(true);
    expect(isFontCollection(roboto)).toBe(false);
  });

  it('finds a face by its PostScript name', () => {
    expect(collectionFaceIndex(collection, 'Roboto-Regular')).toBe(0);
    expect(collectionFaceIndex(collection, 'Tinos-Bold')).toBe(1);
    expect(collectionFaceIndex(collection, 'NotInHere')).toBeNull();
  });

  it('falls back to the only face of a one-face collection', () => {
    expect(collectionFaceIndex(collectionOf([tinos]), 'Renamed-Face')).toBe(0);
  });

  it('extracts a standalone face that parses with its own name and glyphs', () => {
    const extracted = extractCollectionFace(collection, 1);
    const bytes = new Uint8Array(extracted);
    expect(isFontCollection(bytes)).toBe(false);
    expect(postscriptName(extracted)).toBe('Tinos-Bold');
    const original = parse(tinos.slice().buffer);
    const copy = parse(extracted);
    expect(copy.numGlyphs).toBe(original.numGlyphs);
    expect(copy.getPath('Kerf', 0, 0, 72).toPathData(2)).toBe(
      original.getPath('Kerf', 0, 0, 72).toPathData(2),
    );
  });

  it('keeps every table record pointing inside the file on 4-byte boundaries', () => {
    const bytes = new Uint8Array(extractCollectionFace(collection, 0));
    const data = new DataView(bytes.buffer);
    const tables = data.getUint16(4);
    for (let index = 0; index < tables; index++) {
      const offset = data.getUint32(12 + index * 16 + 8);
      const length = data.getUint32(12 + index * 16 + 12);
      expect(offset % 4).toBe(0);
      expect(offset + length).toBeLessThanOrEqual(bytes.byteLength);
    }
  });

  it('rewrites head.checkSumAdjustment so the whole file sums to the magic number', () => {
    const bytes = new Uint8Array(extractCollectionFace(collection, 1));
    expect(fontChecksum(bytes)).toBe(0xb1b0afba);
  });

  it('refuses a face index the collection does not have', () => {
    expect(() => extractCollectionFace(collection, 2)).toThrow('not in the font collection');
  });

  it('reports Restricted License embedding from OS/2 fsType', () => {
    expect(fontEmbeddingRestricted(roboto)).toBe(false);
    const restricted = withFsType(roboto, 0x0002);
    expect(fontEmbeddingRestricted(restricted)).toBe(true);
    expect(fontEmbeddingRestricted(withFsType(roboto, 0x0302))).toBe(true);
  });

  // A project file is edited and shared, so Preview & Print (documents opened
  // read-only) and bitmap-only embedding (no outlines) limit it too.
  it('reports Preview & Print and bitmap-only embedding, not Installable or Editable', () => {
    expect(fontEmbeddingRestricted(withFsType(roboto, 0x0004))).toBe(true);
    expect(fontEmbeddingRestricted(withFsType(roboto, 0x0200))).toBe(true);
    expect(fontEmbeddingRestricted(withFsType(roboto, 0x0208))).toBe(true);
    expect(fontEmbeddingRestricted(withFsType(roboto, 0x0000))).toBe(false);
    expect(fontEmbeddingRestricted(withFsType(roboto, 0x0008))).toBe(false);
    expect(fontEmbeddingRestricted(withFsType(roboto, 0x0100))).toBe(false);
    // Several usage bits (OS/2 versions 0 to 2): the least restrictive wins.
    expect(fontEmbeddingRestricted(withFsType(roboto, 0x000c))).toBe(false);
    expect(fontEmbeddingRestricted(withFsType(roboto, 0x0006))).toBe(true);
    // Versions 0 and 1 assign only bits 0 to 3, so bit 9 is ignored there.
    expect(fontEmbeddingRestricted(withOs2Version(withFsType(roboto, 0x0200), 1))).toBe(false);
  });
});

function withFsType(font: Uint8Array, fsType: number): Uint8Array {
  const copy = font.slice();
  const data = new DataView(copy.buffer);
  const tables = data.getUint16(4);
  for (let index = 0; index < tables; index++) {
    const at = 12 + index * 16;
    if (data.getUint32(at) === 0x4f532f32) data.setUint16(data.getUint32(at + 8) + 8, fsType);
  }
  return copy;
}

function withOs2Version(font: Uint8Array, version: number): Uint8Array {
  const copy = font.slice();
  const data = new DataView(copy.buffer);
  const tables = data.getUint16(4);
  for (let index = 0; index < tables; index++) {
    const at = 12 + index * 16;
    if (data.getUint32(at) === 0x4f532f32) data.setUint16(data.getUint32(at + 8), version);
  }
  return copy;
}
