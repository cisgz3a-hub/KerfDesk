import { describe, expect, it } from 'vitest';

import { contourDetailProfile, hasSupersampleWorthyContourDetail } from './contour-detail-detector';
import { TRACE_PRESETS } from './trace-presets';
import type { RawImageData } from './trace-image';

const LINE_ART = TRACE_PRESETS['Line Art']!;

function whiteImage(width: number, height: number): RawImageData {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}

function paintRect(
  image: RawImageData,
  left: number,
  top: number,
  width: number,
  height: number,
  luma = 0,
): void {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = luma;
      image.data[offset + 1] = luma;
      image.data[offset + 2] = luma;
      image.data[offset + 3] = 255;
    }
  }
}

function colorfulPicture(width: number, height: number, cellSize = 8): RawImageData {
  const image = whiteImage(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dark = (Math.floor(x / cellSize) + Math.floor(y / cellSize)) % 2 === 0;
      const offset = (y * width + x) * 4;
      image.data[offset] = dark ? 20 : 240;
      image.data[offset + 1] = dark ? 80 : 180;
      image.data[offset + 2] = dark ? 180 : 40;
    }
  }
  return image;
}

describe('hasSupersampleWorthyContourDetail', () => {
  it('keeps broad filled artwork on the native-resolution path', () => {
    const image = whiteImage(512, 512);
    paintRect(image, 64, 96, 384, 320);
    expect(hasSupersampleWorthyContourDetail(image, LINE_ART)).toBe(false);
  });

  it('does not confuse the corners of a thick frame with coherent thin detail', () => {
    const image = whiteImage(512, 512);
    paintRect(image, 64, 64, 384, 12);
    paintRect(image, 64, 436, 384, 12);
    paintRect(image, 64, 64, 12, 384);
    paintRect(image, 436, 64, 12, 384);
    expect(hasSupersampleWorthyContourDetail(image, LINE_ART)).toBe(false);
  });

  it('finds a coherent two-pixel detail beside thick artwork', () => {
    const image = whiteImage(512, 512);
    paintRect(image, 64, 96, 280, 320);
    paintRect(image, 380, 180, 2, 80);
    expect(hasSupersampleWorthyContourDetail(image, LINE_ART)).toBe(true);
  });

  it('finds a two-pixel spur attached to a broad shape', () => {
    const image = whiteImage(512, 512);
    paintRect(image, 64, 96, 280, 320);
    paintRect(image, 344, 220, 64, 2);
    expect(hasSupersampleWorthyContourDetail(image, LINE_ART)).toBe(true);
  });

  it('ignores isolated noise removed by the preset despeckle floor', () => {
    const image = whiteImage(512, 512);
    paintRect(image, 80, 80, 200, 200);
    paintRect(image, 400, 400, 2, 2);
    expect(hasSupersampleWorthyContourDetail(image, LINE_ART)).toBe(false);
  });

  it('reports dense color-picture masks separately from sparse thin detail', () => {
    const profile = contourDetailProfile(colorfulPicture(256, 256), LINE_ART);
    expect(profile.hasThinDetail).toBe(false);
    expect(profile.transitionDensity).toBeGreaterThan(0.025);
  });

  it('returns false for blank and malformed images', () => {
    expect(hasSupersampleWorthyContourDetail(whiteImage(64, 64), LINE_ART)).toBe(false);
    expect(
      hasSupersampleWorthyContourDetail(
        { width: 64, height: 64, data: new Uint8ClampedArray(1) },
        LINE_ART,
      ),
    ).toBe(false);
  });
});
