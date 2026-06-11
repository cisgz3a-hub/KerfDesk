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

function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}
function u32le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

// A minimal little-endian EXIF APP1 JPEG: TIFF header + IFD0 with XResolution
// (RATIONAL at offset 38) and ResolutionUnit. unit 2 = inch, 3 = cm.
function jpegWithExif(dpi: number, unit: number): Uint8Array {
  const tiff = [
    0x49,
    0x49,
    ...u16le(0x2a),
    ...u32le(8), // 'II', magic, IFD0 offset
    ...u16le(2), // entry count
    ...u16le(0x011a),
    ...u16le(5),
    ...u32le(1),
    ...u32le(38), // XResolution -> rational @38
    ...u16le(0x0128),
    ...u16le(3),
    ...u32le(1),
    ...u16le(unit),
    0,
    0, // ResolutionUnit inline
    ...u32le(0), // next IFD
    ...u32le(dpi),
    ...u32le(1), // rational num/den
  ];
  const body = [...ascii('Exif'), 0, 0, ...tiff];
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, ...u16(body.length + 2), ...body]);
}

describe('densityFromBytes', () => {
  it('reads PNG pHYs (11811 px/m, unit=metre) as ~300 DPI', () => {
    expect(densityFromBytes(pngWithPhys(11811, 1))).toBe(300);
  });

  it('ignores PNG pHYs with a unitless (0) measurement', () => {
    expect(densityFromBytes(pngWithPhys(11811, 0))).toBeNull();
  });

  it('rejects an absurdly low PNG pHYs density (1-19 px/m would round to 0 DPI)', () => {
    // A crafted/corrupt pHYs of 10 px/m rounds to 0 DPI; returning 0 produced
    // Infinity bounds + a NaN transform downstream that corrupted .lf2 saves.
    expect(densityFromBytes(pngWithPhys(10, 1))).toBeNull();
  });

  it('rejects an absurdly high PNG pHYs density (out of the sane DPI range)', () => {
    expect(densityFromBytes(pngWithPhys(40_000_000, 1))).toBeNull();
  });

  it('reads JPEG JFIF units=1 density=300 as 300 DPI', () => {
    expect(densityFromBytes(jpegWithJfif(1, 300))).toBe(300);
  });

  it('converts JPEG JFIF units=2 (dots/cm) to DPI', () => {
    // 118 dots/cm * 2.54 = 299.72 -> 300
    expect(densityFromBytes(jpegWithJfif(2, 118))).toBe(300);
  });

  it('reads EXIF (APP1) XResolution as DPI for inch units', () => {
    expect(densityFromBytes(jpegWithExif(300, 2))).toBe(300);
  });

  it('converts EXIF cm units to DPI', () => {
    // 118 dots/cm * 2.54 = 299.72 -> 300
    expect(densityFromBytes(jpegWithExif(118, 3))).toBe(300);
  });

  it('skips 0xFF fill bytes between JPEG segments', () => {
    // A spurious 0xFF fill byte after SOI used to be read as a marker with a
    // garbage length, aborting the scan before the JFIF segment.
    const base = jpegWithJfif(1, 300);
    const withFill = new Uint8Array([...base.slice(0, 2), 0xff, ...base.slice(2)]);
    expect(densityFromBytes(withFill)).toBe(300);
  });

  it('returns null when there is no recognisable density metadata', () => {
    expect(densityFromBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeNull();
    expect(densityFromBytes(new Uint8Array([...PNG_SIG, ...pngChunk('IEND', [])]))).toBeNull();
  });
});
