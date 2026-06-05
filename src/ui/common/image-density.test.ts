import { describe, expect, it } from 'vitest';
import { densityFromBytes } from './image-density';

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function u16(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}
function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngChunk(type: string, data: number[]): number[] {
  return [...u32(data.length), ...ascii(type), ...data, 0, 0, 0, 0]; // dummy CRC
}

function pngWithPhys(ppm: number, unit: number): Uint8Array {
  return new Uint8Array([...PNG_SIG, ...pngChunk('pHYs', [...u32(ppm), ...u32(ppm), unit])]);
}

function jpegWithJfif(units: number, density: number): Uint8Array {
  const data = [...ascii('JFIF'), 0x00, 1, 2, units, ...u16(density), ...u16(density), 0, 0];
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...u16(data.length + 2), ...data]);
}

describe('densityFromBytes', () => {
  it('reads PNG pHYs (11811 px/m, unit=metre) as ~300 DPI', () => {
    expect(densityFromBytes(pngWithPhys(11811, 1))).toBe(300);
  });

  it('ignores PNG pHYs with a unitless (0) measurement', () => {
    expect(densityFromBytes(pngWithPhys(11811, 0))).toBeNull();
  });

  it('reads JPEG JFIF units=1 density=300 as 300 DPI', () => {
    expect(densityFromBytes(jpegWithJfif(1, 300))).toBe(300);
  });

  it('converts JPEG JFIF units=2 (dots/cm) to DPI', () => {
    // 118 dots/cm * 2.54 = 299.72 -> 300
    expect(densityFromBytes(jpegWithJfif(2, 118))).toBe(300);
  });

  it('returns null when there is no recognisable density metadata', () => {
    expect(densityFromBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeNull();
    expect(densityFromBytes(new Uint8Array([...PNG_SIG, ...pngChunk('IEND', [])]))).toBeNull();
  });
});
