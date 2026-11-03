// UX audit U3-P2-3 (ADR-581 Amendment 1): a 12 MP phone photo previews at the
// burn grid its placed size and lines per mm make, and the preview shows the
// burn's own dots. The source is one read, never charged as if it all burned.

import { describe, expect, it } from 'vitest';
import { ciBudgetMs } from '../../__fixtures__/ci-budget';
import type { RasterGroup } from '../../core/job';
import { compileRasterGroupsForLayer } from '../../core/job/compile-job-raster';
import { rasterRow } from '../../core/job/raster-rows';
import { STREAMED_RASTER_PIXEL_THRESHOLD } from '../../core/raster/raster-budget';
import { computePhotoEngravingPreview } from './photo-engraving-preview';
import { photoEngravingPreviewPlan } from './photo-engraving-preview-budget';
import { photoPreviewFixture } from './photo-engraving-preview.test-support';
import type {
  PhotoEngravingPreviewInput,
  PhotoEngravingPreviewResult,
} from './photo-engraving-preview-types';

// A 12 MP photo and its burn grids compile in a few seconds on an idle dev box.
// The clock only catches a hang; the assertions decide the verdict.
const PHONE_PHOTO_MS = ciBudgetMs(60_000, 120_000);
const PHOTO_WIDTH = 4000;
const PHOTO_HEIGHT = 3000;
// A smooth portrait-like field: every level from shadow to highlight appears.
const PHOTO_LUMA = (() => {
  const luma = new Uint8Array(PHOTO_WIDTH * PHOTO_HEIGHT);
  for (let y = 0; y < PHOTO_HEIGHT; y += 1) {
    for (let x = 0; x < PHOTO_WIDTH; x += 1) {
      luma[y * PHOTO_WIDTH + x] = Math.round(
        127.5 + 90 * Math.sin(x / 210) * Math.cos(y / 170) + 30 * Math.sin((x + y) / 37),
      );
    }
  }
  return Buffer.from(luma).toString('base64');
})();

function phonePhoto(widthMm: number, linesPerMm = 10): PhotoEngravingPreviewInput {
  const input = photoPreviewFixture();
  const image = {
    ...input.image,
    pixelWidth: PHOTO_WIDTH,
    pixelHeight: PHOTO_HEIGHT,
    lumaBase64: PHOTO_LUMA,
    bounds: { minX: 0, minY: 0, maxX: widthMm, maxY: (widthMm * PHOTO_HEIGHT) / PHOTO_WIDTH },
  };
  return {
    ...input,
    image,
    layer: { ...input.layer, ditherAlgorithm: 'jarvis', linesPerMm },
    sceneObjects: [image],
  };
}

function preview(
  input: PhotoEngravingPreviewInput,
): Extract<PhotoEngravingPreviewResult, { kind: 'ok' }> {
  const result = computePhotoEngravingPreview(input, 1000);
  if (result.kind === 'error') throw new Error(result.message);
  return result;
}

/** The burn's own grid, compiled exactly as output compiles it. */
function burned(input: PhotoEngravingPreviewInput): RasterGroup {
  const group = compileRasterGroupsForLayer([input.image], input.layer, input.device, {
    sceneObjects: input.sceneObjects,
  }).groups[0];
  if (group === undefined) throw new Error('Expected raster group');
  return group;
}

function shades(group: RasterGroup, width: number, height: number, maximum: number): number[] {
  const totals = new Float64Array(width * height);
  const counts = new Float64Array(width * height);
  for (let y = 0; y < group.pixelHeight; y += 1) {
    const row = rasterRow(group, y);
    for (let x = 0; x < group.pixelWidth; x += 1) {
      const index =
        Math.floor((y * height) / group.pixelHeight) * width +
        Math.floor((x * width) / group.pixelWidth);
      totals[index] = (totals[index] ?? 0) + (row[x] ?? 0);
      counts[index] = (counts[index] ?? 0) + 1;
    }
  }
  return Array.from(totals, (total, index) => {
    const shade = 255 - Math.round((255 * (total / (counts[index] ?? 1))) / maximum);
    return shade;
  });
}

function grey(rgba: Uint8ClampedArray): number[] {
  const out: number[] = [];
  for (let index = 0; index < rgba.length; index += 4) out.push(rgba[index] ?? -1);
  return out;
}

describe('phone photo preview at the burn grid (U3-P2-3)', () => {
  it(
    'previews a 12 MP photo at 100 mm, dot for dot what burns',
    { timeout: PHONE_PHOTO_MS },
    () => {
      const input = phonePhoto(100);
      const result = preview(input);
      expect([result.sourceWidth, result.sourceHeight]).toEqual([1000, 750]);
      expect(result.displayDecimated).toBe(false);
      // Not a re-dithered thumbnail: each display pixel is one burned dot.
      const maximum = input.device.maxPowerS * 0.4;
      expect(grey(result.rgba)).toEqual(shades(burned(input), 1000, 750, maximum));
      // Auto tones has the whole photo to read.
      expect(result.sourceHistogram.reduce((total, count) => total + count, 0)).toBe(
        PHOTO_WIDTH * PHOTO_HEIGHT,
      );
    },
  );

  it('keeps the existing compile for a photo that already previewed', () => {
    const plan = photoEngravingPreviewPlan(photoPreviewFixture());
    expect(plan).toEqual({ kind: 'ok', streamedPixelThreshold: STREAMED_RASTER_PIXEL_THRESHOLD });
  });

  it(
    'streams a 220 mm grid that would not fit materialized, matching the materialized burn',
    {
      timeout: PHONE_PHOTO_MS,
    },
    () => {
      const input = phonePhoto(220);
      expect(photoEngravingPreviewPlan(input)).toEqual({ kind: 'ok', streamedPixelThreshold: 0 });
      const result = preview(input);
      expect([result.sourceWidth, result.sourceHeight]).toEqual([2200, 1650]);
      const group = burned(input);
      // Output materializes this grid; the preview streamed its rows.
      expect(group.rowProvider).toBeUndefined();
      const maximum = input.device.maxPowerS * 0.4;
      expect(grey(result.rgba)).toEqual(shades(group, result.width, result.height, maximum));
    },
  );

  it(
    'says in plain words what to change when even the burn grid is too big',
    { timeout: PHONE_PHOTO_MS },
    () => {
      // 360 mm at 25 lines/mm is 9000 x 6750 dots, beyond the preview's work.
      const result = computePhotoEngravingPreview(phonePhoto(360, 25), 1000);
      expect(result.kind).toBe('error');
      if (result.kind !== 'error') return;
      expect(result.message).toBe(
        'This photo is too big to preview at this size and resolution. Lower the resolution or make the photo smaller. You can still apply the settings.',
      );
      expect(result.message).not.toMatch(/MB|budget|working set/);
      // Auto tones still reads the photo.
      expect(result.sourceHistogram?.reduce((total, count) => total + count, 0)).toBe(
        PHOTO_WIDTH * PHOTO_HEIGHT,
      );
    },
  );
});
