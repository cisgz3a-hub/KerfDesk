import { describe, expect, it } from 'vitest';

import type { RawImageData } from '../../core/trace';
import { rawImageHasTransparency } from './raw-image-transparency';

function opaqueImage(): RawImageData {
  const data = new Uint8ClampedArray(2 * 2 * 4).fill(255);
  return { width: 2, height: 2, data };
}

describe('rawImageHasTransparency', () => {
  it('reports false for a fully opaque image', () => {
    expect(rawImageHasTransparency(opaqueImage())).toBe(false);
  });

  it('reports true when any pixel alpha is below fully opaque', () => {
    const image = opaqueImage();
    // Alpha byte of the last pixel.
    image.data[15] = 254;
    expect(rawImageHasTransparency(image)).toBe(true);
  });
});
