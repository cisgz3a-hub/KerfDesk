// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { decodeBmp, decodePnm } from './decode-bmp-pnm';
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
describe('invalid headless raster input', () => {
  it('rejects truncated PNM before allocating the claimed image', () => {
    const constructor = vi.spyOn(globalThis, 'Uint8ClampedArray');
    try {
      expect(() => decodePnm(bytes('P6 16384 16384 255\n'))).toThrow('truncated');
      expect(constructor).not.toHaveBeenCalled();
    } finally {
      constructor.mockRestore();
    }
  });
  it('rejects a missing binary header delimiter', () => {
    expect(() => decodePnm(bytes('P5 1 1 255X0'))).toThrow('malformed');
  });
  it('takes the newline ending a comment after maxval as the delimiter (pbm(5))', () => {
    const file = new Uint8Array([...bytes('P5\n2 1\n255# made by scanner\n'), 0, 200]);
    const decoded = decodePnm(file);
    expect([decoded.data[0], decoded.data[4]]).toEqual([0, 200]);
    expect(() => decodePnm(bytes('P5 1 1 255# no raster follows'))).toThrow('malformed');
  });
  it('rejects a BMP palette that overlaps pixel data', () => {
    const input = new Uint8Array(58);
    const view = new DataView(input.buffer);
    view.setUint32(10, 54, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, 1, true);
    view.setInt32(22, 1, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 8, true);
    expect(() => decodeBmp(input)).toThrow('palette');
  });
});
