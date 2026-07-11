// decodeRasterLuma tests: the base64 luma decoder's contract (parity with the
// verbatim helper it replaced) plus the identity-keyed decode cache (PRF-05).

import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage } from '../scene';
import { decodeRasterLuma } from './raster-luma-decode';

// Two 2x2 pixels. Distinct object each call so the WeakMap can't alias them.
function rasterObject(lumaBase64?: string): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
    ...(lumaBase64 !== undefined ? { lumaBase64 } : {}),
  };
}

describe('decodeRasterLuma', () => {
  it('decodes base64 luma to one byte per pixel', () => {
    // "AID/QA==" is the standard base64 of the four bytes [0, 128, 255, 64].
    const luma = decodeRasterLuma(rasterObject('AID/QA=='));
    expect(Array.from(luma)).toEqual([0, 128, 255, 64]);
  });

  it('fills white (255) when no luma is attached', () => {
    const luma = decodeRasterLuma(rasterObject(undefined));
    expect(Array.from(luma)).toEqual([255, 255, 255, 255]);
  });

  it('throws on malformed base64', () => {
    expect(() => decodeRasterLuma(rasterObject('####'))).toThrow(/lumaBase64/);
  });

  it('returns the same array instance for a repeated object (cache hit)', () => {
    const obj = rasterObject('AID/QA==');
    const first = decodeRasterLuma(obj);
    const second = decodeRasterLuma(obj);
    expect(second).toBe(first);
  });

  it('does not alias distinct objects with identical content (cache is identity-keyed)', () => {
    const a = decodeRasterLuma(rasterObject('AID/QA=='));
    const b = decodeRasterLuma(rasterObject('AID/QA=='));
    expect(b).not.toBe(a);
    expect(Array.from(b)).toEqual(Array.from(a));
  });
});
