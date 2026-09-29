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

  it('skips a comment right after the header; the CR or LF ending it delimits the raster', () => {
    const grey = new Uint8Array([...ascii('P5\n2 1\n255# made by scanner\n'), 0, 200]);
    expect(reds(decodePnm(grey).rgba)).toEqual([0, 200]);
    // The comment stops before a carriage return, so a following LF is raster.
    const crEnded = new Uint8Array([...ascii('P5 2 1 255#note\r'), 10, 200]);
    expect(reds(decodePnm(crEnded).rgba)).toEqual([10, 200]);
    const bitmap = new Uint8Array([...ascii('P4 3 1#x\n'), 0b10100000]);
    expect(reds(decodePnm(bitmap).rgba)).toEqual([0, 255, 0]);
    // After the delimiter a "#" byte is a sample, not a comment.
    const hash = new Uint8Array([...ascii('P5 2 1 255\n'), 0x23, 7]);
    expect(reds(decodePnm(hash).rgba)).toEqual([35, 7]);
  });

  it('refuses other formats and truncated rasters', () => {
    expect(() => decodePnm(ascii('P7 1 1'))).toThrow('not a PBM, PGM or PPM');
    expect(() => decodePnm(new Uint8Array([...ascii('P6 2 2 255\n'), 1, 2]))).toThrow('truncated');
    expect(() => decodePnm(ascii('P1 2 2 1 0'))).toThrow('truncated');
  });

  it('refuses a truncated huge-header file before allocating its raster', () => {
    const before = process.memoryUsage().arrayBuffers;
    for (const magic of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
      const max = magic === 'P1' || magic === 'P4' ? '' : ' 255';
      const bytes = new Uint8Array([...ascii(`${magic} 16384 16384${max}\n`), 1, 2, 3]);
      expect(() => decodePnm(bytes)).toThrow('truncated');
    }
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(16 * 1024 * 1024);
  });

  it('refuses an edge over the TIFF import limit of 16384 px', () => {
    expect(() => decodePnm(ascii('P5 16385 1 255\n'))).toThrow('1-16384 px');
    expect(() => decodePnm(ascii('P1 1 16385\n'))).toThrow('1-16384 px');
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
