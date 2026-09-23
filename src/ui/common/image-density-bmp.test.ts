import { describe, expect, it } from 'vitest';
import { densityFromBytes, normalizeImageDensity } from './image-density';

function bmp(x: number, y: number, dib = 40) {
  const bytes = new Uint8Array(54);
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d]);
  view.setUint32(14, dib, true);
  view.setInt32(38, x, true);
  view.setInt32(42, y, true);
  return bytes;
}

describe('BMP physical density', () => {
  it('uses both encoded pixels-per-metre axes', () => {
    expect(densityFromBytes(bmp(10000, 20000))).toEqual({ xDpi: 254, yDpi: 508 });
  });
  it('falls back on missing, truncated or invalid density rather than poisoning bounds', () => {
    expect(densityFromBytes(bmp(0, 0))).toBeNull();
    expect(densityFromBytes(bmp(-10000, 10000))).toBeNull();
    expect(densityFromBytes(bmp(10000, 10000, 108))).toBeNull();
    expect(densityFromBytes(bmp(10000, 10000).subarray(0, 42))).toBeNull();
    expect(normalizeImageDensity(NaN)).toBeNull();
    expect(normalizeImageDensity(Infinity)).toBeNull();
  });
});
