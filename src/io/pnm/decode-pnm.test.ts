import { describe, expect, it } from 'vitest';
import { decodePnm, isPnmFileName } from './decode-pnm';

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);
const reds = (rgba: Uint8ClampedArray): number[] => Array.from(rgba).filter((_, i) => i % 4 === 0);

describe('decodePnm', () => {
  it('reads plain PBM with comments and unseparated digits (1 is black)', () => {
    const image = decodePnm(ascii('P1\n# mkbitmap\n3 2\n101\n0 1 0\n'));
    expect([image.width, image.height]).toEqual([3, 2]);
    expect(reds(image.rgba)).toEqual([0, 255, 0, 255, 0, 255]);
    expect(image.rgba[3]).toBe(255);
  });

  it('reads raw PBM rows padded to whole bytes', () => {
    const bytes = new Uint8Array([...ascii('P4\n10 2\n'), 0b10000000, 0b01000000, 0xff, 0xc0]);
    expect(reds(decodePnm(bytes).rgba)).toEqual([
      0, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('scales plain and raw PGM by maxval, including 16-bit samples', () => {
    expect(reds(decodePnm(ascii('P2 2 1 15 0 15')).rgba)).toEqual([0, 255]);
    const raw16 = new Uint8Array([...ascii('P5 2 1 65535\n'), 0x80, 0x00, 0xff, 0xff]);
    expect(reds(decodePnm(raw16).rgba)).toEqual([128, 255]);
  });

  it('reads plain and raw PPM colour', () => {
    expect(Array.from(decodePnm(ascii('P3 1 1 255 10 20 30')).rgba)).toEqual([10, 20, 30, 255]);
    const raw = new Uint8Array([...ascii('P6 1 1 255\n'), 1, 2, 3]);
    expect(Array.from(decodePnm(raw).rgba)).toEqual([1, 2, 3, 255]);
  });

  it('refuses other formats and truncated rasters', () => {
    expect(() => decodePnm(ascii('P7 1 1'))).toThrow('not a PBM, PGM or PPM');
    expect(() => decodePnm(new Uint8Array([...ascii('P6 2 2 255\n'), 1, 2]))).toThrow('truncated');
    expect(() => decodePnm(ascii('P1 2 2 1 0'))).toThrow('truncated');
  });

  it('recognises Netpbm extensions', () => {
    expect(['a.pbm', 'b.PGM', 'c.ppm', 'd.pnm', 'e.png'].map(isPnmFileName)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });
});
