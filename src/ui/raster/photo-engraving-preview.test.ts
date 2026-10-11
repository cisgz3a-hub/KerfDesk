import { describe, expect, it } from 'vitest';
import { DEFAULT_ROTARY_SETUP } from '../../core/devices/rotary';
import type { RasterGroup } from '../../core/job';
import { compileRasterGroupsForLayer } from '../../core/job/compile-job-raster';
import { rasterRow } from '../../core/job/raster-rows';
import { IDENTITY_TRANSFORM } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { computePhotoEngravingPreview } from './photo-engraving-preview';
import { photoEngravingPreviewInputError } from './photo-engraving-preview-budget';
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

function compiled(input: PhotoEngravingPreviewInput): RasterGroup {
  const group = compileRasterGroupsForLayer([input.image], input.layer, input.device, {
    sceneObjects: input.sceneObjects,
  }).groups[0];
  if (group === undefined) throw new Error('Expected raster group');
  return group;
}

describe('photo engraving preview', () => {
  it('uses the physical size and selected interval before reducing the display', () => {
    const input = photoPreviewFixture();
    const coarse = preview(input);
    const fine = preview({ ...input, layer: { ...input.layer, linesPerMm: 10 } }, 20);
    expect([coarse.sourceWidth, coarse.sourceHeight]).toEqual([8, 4]);
    expect([fine.sourceWidth, fine.sourceHeight]).toEqual([80, 40]);
    expect([fine.width, fine.height]).toEqual([20, 10]);
    expect(fine.displayDecimated).toBe(true);
    expect(coarse.displayDecimated).toBe(false);
  });

  it('shows independent averages of the compiled dots, never a re-dithered thumbnail', () => {
    const input = photoPreviewFixture();
    const staged = { ...input, layer: { ...input.layer, linesPerMm: 9 } };
    const group = compiled(staged);
    const result = preview(staged, 13);
    const expected = independentBlockAverages(group, result.width, result.height);
    const maximum = input.device.maxPowerS * 0.4;
    expect(Array.from(result.rgba)).toEqual(
      expected.flatMap((power) => {
        const shade = 255 - Math.round((255 * power) / maximum);
        return [shade, shade, shade, 255];
      }),
    );
    expect(expected.some((power) => power > 0 && power < maximum)).toBe(true);
  });

  it('resolves image overrides and power scale while keeping full marks black', () => {
    const input = photoPreviewFixture();
    const staged = {
      ...input,
      layer: { ...input.layer, mode: 'line' as const, linesPerMm: 25 },
      image: {
        ...input.image,
        powerScale: 50,
        operationOverride: { mode: 'image' as const, linesPerMm: 2, power: 20 },
      },
    };
    const before = structuredClone(staged);
    const result = preview(staged);
    expect([result.sourceWidth, result.sourceHeight]).toEqual([16, 8]);
    expect(compiled(staged).power).toBe(10);
    expect(result.rgba.some((value, index) => index % 4 === 0 && value === 0)).toBe(true);
    expect(result.normalization).toBe('relative-marks');
    expect(staged).toEqual(before);
    const zero = preview({ ...staged, image: { ...staged.image, powerScale: 0 } });
    expect(zero.rgba.every((value) => value === 255)).toBe(true);
  });

  it('preserves pass-through density, raw source tone and the existing mask', () => {
    const input = photoPreviewFixture();
    const mask = createRectangle({
      id: 'mask',
      color: '#000000',
      spec: { widthMm: 4, heightMm: 4, cornerRadiusMm: 0 },
    });
    const staged = {
      ...input,
      image: { ...input.image, imageMaskId: mask.id, brightness: 100, gamma: 5 },
      layer: { ...input.layer, passThrough: true, negativeImage: true },
      sceneObjects: [mask],
    };
    const result = preview(staged);
    const group = compiled(staged);
    expect([result.sourceWidth, result.sourceHeight]).toEqual([4, 2]);
    expect(result.rgba.some((value, index) => index % 4 === 0 && value > 0 && value < 255)).toBe(
      true,
    );
    const maximum = input.device.maxPowerS * 0.4;
    expect(Array.from(result.rgba)).toEqual(
      Array.from(group.sValues).flatMap((power) => {
        const shade = 255 - Math.round((255 * power) / maximum);
        return [shade, shade, shade, 255];
      }),
    );
    expect(Array.from(group.sValues).filter((power) => power === 0).length).toBeGreaterThanOrEqual(
      4,
    );
  });

  it('uses the actual rotated scan grid and discloses multiple scans', () => {
    const input = photoPreviewFixture();
    const staged = {
      ...input,
      image: { ...input.image, transform: { ...IDENTITY_TRANSFORM, rotationDeg: 30 } },
      layer: { ...input.layer, imageScanAngleDeg: 45, imageCrossHatch: true, passes: 2 },
    };
    const result = preview(staged);
    const group = compiled(staged);
    expect([result.sourceWidth, result.sourceHeight]).toEqual([
      group.pixelWidth,
      group.pixelHeight,
    ]);
    expect(result.bounds).toEqual(group.bounds);
    expect(result.scanAngleDeg).toBe(45);
    expect(result.scanPasses).toBe(4);
    expect(result.scanCount).toBe(4);
  });

  it('rejects oversized source, rotated grid, pass plan and absent pixels before compile', () => {
    const input = photoPreviewFixture();
    const cases = [
      { ...input, image: { ...input.image, pixelWidth: 100_000, pixelHeight: 100_000 } },
      {
        ...input,
        image: {
          ...input.image,
          bounds: { minX: 0, minY: 0, maxX: 8000, maxY: 8000 },
          transform: { ...IDENTITY_TRANSFORM, rotationDeg: 45 },
        },
      },
      { ...input, layer: { ...input.layer, imageCrossHatch: true, passes: 1_000_000_000 } },
      {
        ...input,
        image: {
          ...input.image,
          imageClip: [
            {
              color: input.image.color,
              polylines: [
                {
                  closed: true,
                  points: Array<{ x: number; y: number }>(400_000).fill({ x: 0, y: 0 }),
                },
              ],
            },
          ],
        },
      },
      {
        ...input,
        image: { ...input.image, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 50_000_000 } },
      },
    ];
    for (const staged of cases) expect(computePhotoEngravingPreview(staged).kind).toBe('error');
    const { lumaBase64: _pixels, ...image } = input.image;
    expect(photoEngravingPreviewInputError({ ...input, image })).toMatch(/pixels.*not ready/);
  });

  it('reports malformed source pixels instead of a successful blank preview', () => {
    const input = photoPreviewFixture();
    expect(
      computePhotoEngravingPreview({ ...input, image: { ...input.image, lumaBase64: 'AA==' } }),
    ).toEqual({ kind: 'error', message: expect.stringContaining('malformed') });
  });

  it('budgets the discarded angled pass plan before a rotary compile', () => {
    const input = photoPreviewFixture();
    const staged = {
      ...input,
      device: { ...input.device, rotary: { ...DEFAULT_ROTARY_SETUP, enabled: true } },
      layer: { ...input.layer, imageCrossHatch: true, passes: 500_000 },
    };
    // The core compiler constructs the angled plan before replacing it with
    // along-X rotary passes. Its transient plan must fit the preview too.
    expect(photoEngravingPreviewInputError(staged)).toContain('too many different pass runs');
  });

  it('still previews an ordinary rotary scan with the compiler-selected angle', () => {
    const input = photoPreviewFixture();
    const result = preview({
      ...input,
      device: { ...input.device, rotary: { ...DEFAULT_ROTARY_SETUP, enabled: true } },
      layer: { ...input.layer, imageScanAngleDeg: 45, imageCrossHatch: true, passes: 2 },
    });
    expect(result.scanAngleDeg).toBe(0);
    expect(result.scanCount).toBe(1);
    expect(result.scanPasses).toBe(2);
  });

  it('reduces the streamed grid without allocating the full power image', () => {
    const input = photoPreviewFixture();
    const staged = {
      ...input,
      image: {
        ...input.image,
        pixelWidth: 1,
        pixelHeight: 1,
        lumaBase64: Buffer.from([128]).toString('base64'),
        bounds: { minX: 0, minY: 0, maxX: 2001, maxY: 2000 },
      },
      layer: { ...input.layer, ditherAlgorithm: 'grayscale' as const },
    };
    const result = preview(staged, 10);
    expect([result.sourceWidth, result.sourceHeight]).toEqual([2001, 2000]);
    expect([result.width, result.height]).toEqual([10, 10]);
    expect(result.displayDecimated).toBe(true);
    expect(Array.from(result.rgba)).toEqual(Array<number[]>(100).fill([128, 128, 128, 255]).flat());
  });
});

function independentBlockAverages(group: RasterGroup, width: number, height: number): number[] {
  const totals = Array<number>(width * height).fill(0);
  const counts = Array<number>(width * height).fill(0);
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
  return totals.map((total, index) => total / (counts[index] ?? 1));
}
