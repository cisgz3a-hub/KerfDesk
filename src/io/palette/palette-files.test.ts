import { describe, expect, it } from 'vitest';
import { writeAdobeSwatchExchange, writeCorelPalette, writeGimpPalette } from './palette-files';

const COLORS = [
  { name: 'Black', hex: '#000000' },
  { name: 'Blue & co', hex: '#2563eb' },
];

describe('palette files', () => {
  it('writes a GIMP palette with 0-255 channels', () => {
    const text = writeGimpPalette('KerfDesk', COLORS);
    expect(text.split('\n').slice(0, 2)).toEqual(['GIMP Palette', 'Name: KerfDesk']);
    expect(text).toContain(' 37  99 235\tBlue & co');
  });

  it('writes a CorelDRAW palette with 0-1 RGB tints and escaped names', () => {
    const xml = writeCorelPalette('KerfDesk', COLORS);
    expect(xml).toContain(
      '<color cs="RGB" tints="0.145098,0.388235,0.921569" name="Blue &amp; co"/>',
    );
  });

  it('writes Adobe Swatch Exchange blocks: signature, version, count, UTF-16 names and float RGB', () => {
    const bytes = writeAdobeSwatchExchange(COLORS);
    const view = new DataView(bytes.buffer);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('ASEF');
    expect([view.getUint16(4), view.getUint16(6), view.getUint32(8)]).toEqual([1, 0, 2]);
    // First block: type, length, name "Black\0" (6 UTF-16 units), "RGB ", 3 floats, type.
    expect(view.getUint16(12)).toBe(1);
    expect(view.getUint32(14)).toBe(2 + 12 + 4 + 12 + 2);
    expect(view.getUint16(18)).toBe(6);
    expect(String.fromCharCode(view.getUint16(20))).toBe('B');
    expect(String.fromCharCode(...bytes.slice(32, 36))).toBe('RGB ');
    expect(view.getFloat32(36)).toBe(0);
    const second = 12 + 6 + view.getUint32(14);
    const nameUnits = view.getUint16(second + 6);
    const floats = second + 8 + nameUnits * 2 + 4;
    expect(view.getFloat32(floats + 8)).toBeCloseTo(235 / 255, 6);
    expect(bytes.length).toBe(second + 6 + view.getUint32(second + 2));
  });
});
