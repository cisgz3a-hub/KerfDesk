import { describe, expect, it } from 'vitest';
import { decodePng } from '../../__fixtures__/perceptual/png-decode';
import { decodeCanonicalBase64 } from '../relief/depth-map-base64';
import { MATERIAL_TEST_RAMP } from './material-test-ramp';

function bytes(base64: string): Uint8Array {
  const decoded = decodeCanonicalBase64(base64);
  if (decoded.kind !== 'ok') throw new Error('invalid base64');
  return decoded.bytes;
}

describe('MATERIAL_TEST_RAMP', () => {
  it('displays exactly the five-band luma it burns', () => {
    const png = decodePng(bytes(MATERIAL_TEST_RAMP.dataUrl.replace('data:image/png;base64,', '')));
    expect([png.width, png.height]).toEqual([MATERIAL_TEST_RAMP.width, MATERIAL_TEST_RAMP.height]);
    const luma = bytes(MATERIAL_TEST_RAMP.lumaBase64);
    expect(luma).toHaveLength(MATERIAL_TEST_RAMP.width * MATERIAL_TEST_RAMP.height);
    for (let pixel = 0; pixel < luma.length; pixel += 1) {
      const [r, g, b] = [0, 1, 2].map((channel) => png.data[pixel * 4 + channel] ?? -1);
      expect([r, g, b]).toEqual([luma[pixel], luma[pixel], luma[pixel]]);
    }
    expect([...new Set(luma)]).toEqual([204, 153, 102, 51, 0]);
  });
});
