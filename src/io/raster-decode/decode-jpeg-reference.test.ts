// @vitest-environment node
// ADR-477 point 3: the headless trace command decodes JPEG with pdf.js, not
// the libjpeg-turbo decode Chromium and Electron run, so JPEG pixels are not
// the app's pixels. This pins how far apart the two decoders sit on a JPEG
// with saturated colour edges and 4:2:0 chroma, against a libjpeg-turbo
// reference decode, so a decoder change that widens the gap fails here.

import { describe, expect, it } from 'vitest';
import {
  JPEG_FIXTURE_BASE64,
  JPEG_FIXTURE_HEIGHT,
  JPEG_FIXTURE_LIBJPEG_TURBO_RGB_BASE64,
  JPEG_FIXTURE_WIDTH,
} from '../../__fixtures__/jpeg-libjpeg-turbo-reference';
import { decodeRaster } from './decode-raster';

const bytesOf = (base64: string): Uint8Array => Uint8Array.from(Buffer.from(base64, 'base64'));
const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

type Gap = {
  readonly maxChannel: number;
  readonly maxLuma: number;
  readonly meanLuma: number;
};

function decoderGap(ours: Uint8ClampedArray, reference: Uint8Array): Gap {
  let maxChannel = 0;
  let maxLuma = 0;
  let sumLuma = 0;
  const count = reference.length / 3;
  for (let i = 0; i < count; i += 1) {
    const [r, g, b] = [ours[i * 4] ?? 0, ours[i * 4 + 1] ?? 0, ours[i * 4 + 2] ?? 0];
    const [R, G, B] = [reference[i * 3] ?? 0, reference[i * 3 + 1] ?? 0, reference[i * 3 + 2] ?? 0];
    maxChannel = Math.max(maxChannel, Math.abs(r - R), Math.abs(g - G), Math.abs(b - B));
    const a = luma(r, g, b);
    const bRef = luma(R, G, B);
    maxLuma = Math.max(maxLuma, Math.abs(a - bRef));
    sumLuma += Math.abs(a - bRef);
  }
  return { maxChannel, maxLuma, meanLuma: sumLuma / count };
}

describe('headless JPEG decode against libjpeg-turbo (ADR-477)', () => {
  it('stays within a few luma levels of the browser-family decode', async () => {
    const image = await decodeRaster(bytesOf(JPEG_FIXTURE_BASE64));
    expect([image.width, image.height]).toEqual([JPEG_FIXTURE_WIDTH, JPEG_FIXTURE_HEIGHT]);
    const gap = decoderGap(image.data, bytesOf(JPEG_FIXTURE_LIBJPEG_TURBO_RGB_BASE64));
    // Measured 2026-09-27 (pdfjs-dist on this base): max luma 12.5, mean luma
    // 1.0, max channel 73 (red/blue chroma edges). Not zero: the decoders
    // differ, so JPEG output is close to the app's, never promised identical.
    expect(gap.maxLuma).toBeGreaterThan(0);
    expect(gap.maxLuma).toBeLessThanOrEqual(16);
    expect(gap.meanLuma).toBeLessThanOrEqual(1.5);
    expect(gap.maxChannel).toBeLessThanOrEqual(96);
  });
});
