import { describe, expect, it } from 'vitest';
import { computePhotoEngravingPreview } from './photo-engraving-preview';
import { photoPreviewFixture } from './photo-engraving-preview.test-support';
import type {
  PhotoEngravingPreviewInput,
  PhotoEngravingPreviewResult,
} from './photo-engraving-preview-types';

type Success = Extract<PhotoEngravingPreviewResult, { kind: 'ok' }>;

function preview(input: PhotoEngravingPreviewInput, maxEdge = 1000): Success {
  const result = computePhotoEngravingPreview(input, maxEdge);
  if (result.kind === 'error') throw new Error(result.message);
  return result;
}

function meanGrey(rgba: Uint8ClampedArray): number {
  let sum = 0;
  for (let index = 0; index < rgba.length; index += 4) sum += rgba[index] ?? 0;
  return sum / (rgba.length / 4);
}

/** A mid-grey photo at 10 lines/mm, on a laser with the 4040's 0.16 x 0.18 mm spot or none. */
function midGrey(withSpot: boolean): PhotoEngravingPreviewInput {
  const input = photoPreviewFixture();
  const luma = Buffer.alloc(64 * 32, 128).toString('base64');
  return {
    ...input,
    image: { ...input.image, pixelWidth: 64, pixelHeight: 32, lumaBase64: luma },
    layer: { ...input.layer, linesPerMm: 10 },
    device: {
      ...input.device,
      laserSubProfile: {
        model: 'Test diode',
        focusMode: 'fixed-lever',
        airAssist: 'manual',
        ...(withSpot ? { spotSizeMm: { x: 0.16, y: 0.18 } } : {}),
      },
    },
    materialView: true,
  };
}

describe('photo material preview (ADR-685)', () => {
  it('reports the source histogram with every preview', () => {
    const result = preview(photoPreviewFixture());
    expect(Array.from(result.sourceHistogram).reduce((sum, n) => sum + n, 0)).toBe(8);
    expect(result.sourceHistogram[0]).toBe(2);
    expect(result.sourceHistogram[255]).toBe(2);
  });

  it('draws the material view only when asked', () => {
    expect(preview(photoPreviewFixture()).materialRgba).toBeUndefined();
  });

  it('darkens overlapping dots by the laser spot, on the same display grid', () => {
    const result = preview(midGrey(true), 40);
    expect(result.materialSpread).toMatchObject({ kind: 'spot', subdivisions: 3 });
    expect(result.materialRgba?.length).toBe(result.rgba.length);
    const dots = meanGrey(result.rgba);
    const material = meanGrey(result.materialRgba ?? new Uint8ClampedArray());
    // Half the cells burn; 1.7-cell spots cover much more than half the surface.
    expect(dots).toBeGreaterThan(100);
    expect(material).toBeLessThan(dots - 40);
  });

  it('draws one-cell marks and says so when the spot is unknown', () => {
    const result = preview(midGrey(false), 40);
    expect(result.materialSpread).toEqual({ kind: 'unknown-spot' });
    expect(Array.from(result.materialRgba ?? [])).toEqual(Array.from(result.rgba));
  });
});
