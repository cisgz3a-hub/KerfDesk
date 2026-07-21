import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { applyImageMaskToLuma, dither, resampleLumaNearest } from '../raster';
import type { DitherAlgorithm } from '../raster/dither';
import { IDENTITY_TRANSFORM, type RasterImage, type SceneObject } from '../scene';
import {
  originFlipsRasterX,
  originFlipsRasterY,
  streamedRasterRowProvider,
} from './compile-job-raster-stream';
import { rotatedMaskedRasterLuma } from './raster-rotated-sample';

const SOURCE_W = 12;
const SOURCE_H = 9;
const TARGET_W = 20;
const TARGET_H = 15;
const S_MAX = 800;

const ALGORITHMS: ReadonlyArray<DitherAlgorithm> = [
  'floyd-steinberg',
  'atkinson',
  'threshold',
  'grayscale',
];
const ORIGINS: ReadonlyArray<DeviceProfile['origin']> = ['rear-left', 'front-right'];

function sourceLuma(): Uint8Array {
  const luma = new Uint8Array(SOURCE_W * SOURCE_H);
  for (let i = 0; i < luma.length; i += 1) luma[i] = (i * 53 + 11) % 256;
  return luma;
}

function image(withMask: boolean): RasterImage {
  return {
    kind: 'raster-image',
    id: 'img',
    color: '#808080',
    source: 'img.png',
    dataUrl: 'data:image/png;base64,unused',
    pixelWidth: SOURCE_W,
    pixelHeight: SOURCE_H,
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
    transform: IDENTITY_TRANSFORM,
    ...(withMask ? { imageMaskId: 'mask' } : {}),
  };
}

// A triangle covering roughly the lower-left half of the image bounds.
function maskObject(): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'mask',
    source: 'mask.svg',
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 40, y: 30 },
              { x: 0, y: 30 },
              { x: 0, y: 0 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
}

function orient(luma: Uint8Array, flipX: boolean, flipY: boolean): Uint8Array {
  const out = new Uint8Array(luma.length);
  for (let y = 0; y < TARGET_H; y += 1) {
    const srcY = flipY ? TARGET_H - 1 - y : y;
    for (let x = 0; x < TARGET_W; x += 1) {
      const srcX = flipX ? TARGET_W - 1 - x : x;
      out[y * TARGET_W + x] = luma[srcY * TARGET_W + srcX] ?? 255;
    }
  }
  return out;
}

function materializedReference(
  obj: RasterImage,
  mask: SceneObject | null,
  device: DeviceProfile,
  algorithm: DitherAlgorithm,
): Uint16Array {
  const resampled = resampleLumaNearest(
    { luma: sourceLuma(), width: SOURCE_W, height: SOURCE_H },
    TARGET_W,
    TARGET_H,
  );
  const masked = applyImageMaskToLuma({
    image: obj,
    maskObject: mask,
    luma: resampled,
    width: TARGET_W,
    height: TARGET_H,
  });
  const oriented = orient(masked, originFlipsRasterX(device), originFlipsRasterY(device));
  return dither(
    { luma: oriented, width: TARGET_W, height: TARGET_H },
    { algorithm, sMax: S_MAX, sMin: 0 },
  );
}

describe('streamedRasterRowProvider', () => {
  // Rotated + error diffusion could not stream before ADR-243; pin it against
  // the materialized rotated pipeline (#321's sampler + full dither).
  for (const withMask of [false, true]) {
    it(`matches the materialized rotated pipeline (floyd-steinberg, mask=${withMask})`, () => {
      const device = { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' as const };
      const rotated = {
        ...image(withMask),
        transform: { ...IDENTITY_TRANSFORM, rotationDeg: 30 },
      };
      const mask = withMask ? maskObject() : null;
      const bounds = { minX: 0, minY: 0, maxX: 50, maxY: 45 };
      const sampler = {
        sourceLuma: sourceLuma(),
        obj: rotated,
        device,
        bounds,
        pixelWidth: TARGET_W,
        pixelHeight: TARGET_H,
      };
      const reference = dither(
        {
          luma: rotatedMaskedRasterLuma(sampler, mask),
          width: TARGET_W,
          height: TARGET_H,
        },
        { algorithm: 'floyd-steinberg', sMax: S_MAX, sMin: 0 },
      );
      const rowAt = streamedRasterRowProvider({
        sourceLuma: sourceLuma(),
        sourceWidth: SOURCE_W,
        sourceHeight: SOURCE_H,
        pixelWidth: TARGET_W,
        pixelHeight: TARGET_H,
        obj: rotated,
        maskObject: mask,
        device,
        bounds,
        algorithm: 'floyd-steinberg',
        sMax: S_MAX,
        sMin: 0,
      });
      for (let y = 0; y < TARGET_H; y += 1) {
        expect(rowAt(y), `row ${y}`).toEqual(reference.subarray(y * TARGET_W, (y + 1) * TARGET_W));
      }
    });
  }
  for (const algorithm of ALGORITHMS) {
    for (const origin of ORIGINS) {
      for (const withMask of [false, true]) {
        it(`matches the materialized pipeline (${algorithm}, ${origin}, mask=${withMask})`, () => {
          const device = { ...DEFAULT_DEVICE_PROFILE, origin };
          const obj = image(withMask);
          const mask = withMask ? maskObject() : null;
          const rowAt = streamedRasterRowProvider({
            sourceLuma: sourceLuma(),
            sourceWidth: SOURCE_W,
            sourceHeight: SOURCE_H,
            pixelWidth: TARGET_W,
            pixelHeight: TARGET_H,
            obj,
            maskObject: mask,
            device,
            bounds: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
            algorithm,
            sMax: S_MAX,
            sMin: 0,
          });
          const reference = materializedReference(obj, mask, device, algorithm);
          for (let y = 0; y < TARGET_H; y += 1) {
            expect(rowAt(y), `row ${y}`).toEqual(
              reference.subarray(y * TARGET_W, (y + 1) * TARGET_W),
            );
          }
        });
      }
    }
  }
});
