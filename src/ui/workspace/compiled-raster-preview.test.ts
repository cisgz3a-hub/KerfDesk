import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { RasterGroup } from '../../core/job';
import { compileRasterGroupsForLayer } from '../../core/job/compile-job-raster';
import { rasterRow } from '../../core/job/raster-rows';
import { createLayer, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { compiledRasterPreview } from './compiled-raster-preview';

describe('compiledRasterPreview', () => {
  it('renders asymmetric rotated and mirrored machine grids without re-dithering', () => {
    const layer = imageLayer({ ditherAlgorithm: 'grayscale', linesPerMm: 1 });
    for (const transform of [
      { ...IDENTITY_TRANSFORM, rotationDeg: 90, mirrorX: true },
      { ...IDENTITY_TRANSFORM, rotationDeg: 30, mirrorY: true },
    ]) {
      const group = compileRaster({ ...asymmetricRaster(), transform }, layer);
      const preview = compiledRasterPreview(group, DEFAULT_DEVICE_PROFILE);

      expect(preview.displayDecimated).toBe(false);
      expect(preview.width).toBe(group.pixelWidth);
      expect(preview.height).toBe(group.pixelHeight);
      expect(preview.sValues).toEqual(group.sValues);
    }
  });

  it('gives a large error-diffusion row provider the same display as materialized output', () => {
    const layer = imageLayer({
      ditherAlgorithm: 'floyd-steinberg',
      linesPerMm: 1,
    });
    const streamed = compileRaster(
      {
        ...asymmetricRaster(),
        pixelWidth: 1,
        pixelHeight: 1,
        bounds: { minX: 0, minY: 0, maxX: 2001, maxY: 2000 },
        lumaBase64: encodeLuma([112]),
      },
      layer,
    );

    expect(streamed.rowProvider).toBeDefined();
    expect(streamed.sValues).toHaveLength(0);
    const streamedPreview = compiledRasterPreview(streamed, DEFAULT_DEVICE_PROFILE, 64);
    const materializedValues = new Uint16Array(streamed.pixelWidth * streamed.pixelHeight);
    for (let y = 0; y < streamed.pixelHeight; y += 1) {
      materializedValues.set(rasterRow(streamed, y), y * streamed.pixelWidth);
    }
    const materializedDraft = {
      ...streamed,
      sValues: materializedValues,
    };
    delete materializedDraft.rowProvider;
    const materialized: RasterGroup = materializedDraft;
    const materializedPreview = compiledRasterPreview(materialized, DEFAULT_DEVICE_PROFILE, 64);

    expect(streamedPreview.displayDecimated).toBe(true);
    expect(streamedPreview.sourceWidth * streamedPreview.sourceHeight).toBeGreaterThan(4_000_000);
    expect(streamedPreview.sValues).toEqual(materializedPreview.sValues);
    expect(streamedPreview.rgba).toEqual(materializedPreview.rgba);
  });

  it('reduces a large dithered grid to the tone it burns (ADR-028 Amendment 1)', () => {
    // 50% grey through Floyd-Steinberg burns about half its dots at full power.
    const group = compileRaster(
      {
        ...asymmetricRaster(),
        pixelWidth: 1,
        pixelHeight: 1,
        bounds: { minX: 0, minY: 0, maxX: 300, maxY: 200 },
        lumaBase64: encodeLuma([128]),
      },
      imageLayer({ ditherAlgorithm: 'floyd-steinberg', linesPerMm: 1, power: 100 }),
    );
    const preview = compiledRasterPreview(group, DEFAULT_DEVICE_PROFILE, 128);

    expect(preview.displayDecimated).toBe(true);
    const burned = meanPowerFraction(group);
    expect(burned).toBeGreaterThan(0.4);
    expect(burned).toBeLessThan(0.6);
    expect(Math.abs(meanDarkness(preview.rgba) - burned)).toBeLessThan(0.02);
  });

  it('shows a one-pixel line as the share of its display block it burns', () => {
    const sMax = DEFAULT_DEVICE_PROFILE.maxPowerS;
    // A burned first column in a 4x2 grid shown 2x1: it fills half of the left block.
    const group = powerGrid(4, 2, (x) => (x === 0 ? sMax : 0));

    const preview = compiledRasterPreview(group, DEFAULT_DEVICE_PROFILE, 2);

    expect(Array.from(preview.sValues)).toEqual([sMax / 2, 0]);
    expect([preview.rgba[0], preview.rgba[4]]).toEqual([127, 255]);
  });

  it('renders compiled power against the device maximum instead of normalizing the group', () => {
    const group = compileRaster(asymmetricRaster(), imageLayer({ power: 25 }));
    const preview = compiledRasterPreview(group, DEFAULT_DEVICE_PROFILE);
    const fullGroupPower = Math.round(DEFAULT_DEVICE_PROFILE.maxPowerS * 0.25);
    const poweredPixel = preview.sValues.findIndex((value) => value === fullGroupPower);

    expect(poweredPixel).toBeGreaterThanOrEqual(0);
    expect(preview.rgba[poweredPixel * 4]).toBe(
      255 - Math.round((255 * fullGroupPower) / DEFAULT_DEVICE_PROFILE.maxPowerS),
    );
    expect(preview.rgba[poweredPixel * 4]).toBeGreaterThan(0);
  });
});

function compileRaster(raster: RasterImage, layer: ReturnType<typeof imageLayer>): RasterGroup {
  const result = compileRasterGroupsForLayer([raster], layer, DEFAULT_DEVICE_PROFILE);
  const group = result.groups[0];
  if (group === undefined) throw new Error('Expected raster compilation to produce a group.');
  return group;
}

function imageLayer(
  overrides: Partial<ReturnType<typeof createLayer>> = {},
): ReturnType<typeof createLayer> {
  return {
    ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
    ...overrides,
  };
}

function asymmetricRaster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'asymmetric',
    source: 'asymmetric.png',
    dataUrl: 'data:image/png;base64,unused',
    pixelWidth: 3,
    pixelHeight: 2,
    bounds: { minX: 2, minY: 3, maxX: 8, maxY: 7 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 1,
    lumaBase64: encodeLuma([0, 48, 255, 192, 96, 16]),
  };
}

function encodeLuma(bytes: ReadonlyArray<number>): string {
  return btoa(String.fromCharCode(...bytes));
}

function powerGrid(
  width: number,
  height: number,
  power: (x: number, y: number) => number,
): RasterGroup {
  const sValues = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) sValues[y * width + x] = power(x, y);
  }
  const base = compileRaster(asymmetricRaster(), imageLayer());
  return { ...base, pixelWidth: width, pixelHeight: height, sValues };
}

// Mean emitted power as a fraction of the machine maximum.
function meanPowerFraction(group: RasterGroup): number {
  let sum = 0;
  for (let y = 0; y < group.pixelHeight; y += 1) {
    for (const value of rasterRow(group, y)) sum += value;
  }
  return sum / (group.pixelWidth * group.pixelHeight * DEFAULT_DEVICE_PROFILE.maxPowerS);
}

function meanDarkness(rgba: Uint8ClampedArray): number {
  let dark = 0;
  for (let index = 0; index < rgba.length; index += 4) dark += 1 - (rgba[index] ?? 255) / 255;
  return dark / (rgba.length / 4);
}
