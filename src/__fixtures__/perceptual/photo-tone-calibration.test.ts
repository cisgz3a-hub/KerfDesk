// Photo tone calibration (ADR-670) — does a fitted curve make a dot-gain burn
// track the photo's tones?
//
// The burn model: every fired burn-grid cell marks a disc wider than the cell
// (the 4040's 0.16 x 0.18 mm spot over a 0.1 mm interval is about 1.7 cells
// across), and overlapping discs saturate. That is why an uncalibrated
// error-diffusion portrait burns too dark: the ditherer delivers the asked-for
// dot COUNT, but each dot covers more than its share. Grayscale has the same
// problem through the material: power darkens it non-linearly.
//
// The test follows the user's workflow exactly: generate the wedge with the
// photo's settings, "burn" it with the model, record each patch's observed
// mark strength, fit the curve, then burn the photo with and without it. The
// score is per-block mean darkness against the photo's own darkness, so it is
// the tone a viewer sees from arm's length, not dot placement.
//
// Measured on the NASA portrait (1 mm blocks, darkness 0..1): Jarvis mean
// error 0.164 uncalibrated (all of it too dark) → 0.017; Stucki 0.181 → 0.017;
// grayscale 0.213 → 0.006. A simulation, not a material: it shows the curve
// inverts a known response, not what any real wood or slate does.

import { describe, expect, it } from 'vitest';
import { ciBudgetMs } from '../ci-budget';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { compileRasterGroupsForLayer } from '../../core/job/compile-job-raster';
import type { RasterGroup } from '../../core/job/job';
import { generateToneCalibrationWedge } from '../../core/job/tone-calibration-wedge';
import { fitPhotoToneCurve, type PhotoToneCurve } from '../../core/raster/photo-tone-curve';
import { encodeCanonicalBase64 } from '../../core/relief/depth-map-base64';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type DitherAlgorithm,
  type Layer,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { photoLuma } from './photo-luma';

const ASSET_PATH = 'src/__fixtures__/perceptual/assets/astronaut.png';
const LINES_PER_MM = 10;
const PHOTO_PX = 200; // 20 mm at 10 lines/mm: the burn grid matches the source grid
const BLOCK_CELLS = 10; // 1 mm scoring blocks
const SUPERSAMPLE = 4;
const SPOT_RADIUS_CELLS = 0.85;
const BUDGET_MS = ciBudgetMs(20_000, 60_000);
// No raster flips, so compiled row y / column x is the photo's row y / column x.
const DEVICE: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' };

type Burn = (group: RasterGroup) => Float64Array; // darkness 0..1 per grid cell

function photoOperation(ditherAlgorithm: DitherAlgorithm, curve?: PhotoToneCurve): Layer {
  return {
    ...createLayer({ id: 'photo-op', color: '#808080', mode: 'image' }),
    ditherAlgorithm,
    linesPerMm: LINES_PER_MM,
    power: 50,
    ...(curve === undefined ? {} : { photoToneCurve: curve }),
  };
}

function photoImage(luma: Uint8Array): RasterImage {
  const sizeMm = PHOTO_PX / LINES_PER_MM;
  return {
    kind: 'raster-image',
    id: 'portrait',
    source: 'astronaut.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: encodeCanonicalBase64(luma),
    pixelWidth: PHOTO_PX,
    pixelHeight: PHOTO_PX,
    bounds: { minX: 0, minY: 0, maxX: sizeMm, maxY: sizeMm },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    operationIds: ['photo-op'],
    dither: 'jarvis',
    linesPerMm: LINES_PER_MM,
  };
}

function compile(objects: ReadonlyArray<SceneObject>, layer: Layer): RasterGroup {
  const group = compileRasterGroupsForLayer(objects, layer, DEVICE).groups[0];
  if (group === undefined) throw new Error('Nothing compiled');
  return group;
}

/** Dot gain: each fired cell marks a disc wider than the cell; overlaps saturate. */
const dotGainBurn: Burn = (group) => {
  const width = group.pixelWidth * SUPERSAMPLE;
  const height = group.pixelHeight * SUPERSAMPLE;
  const marked = new Uint8Array(width * height);
  const radius = SPOT_RADIUS_CELLS * SUPERSAMPLE;
  const reach = Math.ceil(radius);
  for (let y = 0; y < group.pixelHeight; y += 1) {
    for (let x = 0; x < group.pixelWidth; x += 1) {
      if ((group.sValues[y * group.pixelWidth + x] ?? 0) <= 0) continue;
      const cx = (x + 0.5) * SUPERSAMPLE;
      const cy = (y + 0.5) * SUPERSAMPLE;
      for (let sy = Math.max(0, Math.floor(cy - reach)); sy < Math.min(height, cy + reach); sy += 1)
        for (
          let sx = Math.max(0, Math.floor(cx - reach));
          sx < Math.min(width, cx + reach);
          sx += 1
        )
          if ((sx + 0.5 - cx) ** 2 + (sy + 0.5 - cy) ** 2 <= radius ** 2)
            marked[sy * width + sx] = 1;
    }
  }
  const darkness = new Float64Array(group.pixelWidth * group.pixelHeight);
  for (let sy = 0; sy < height; sy += 1)
    for (let sx = 0; sx < width; sx += 1) {
      const cell = Math.floor(sy / SUPERSAMPLE) * group.pixelWidth + Math.floor(sx / SUPERSAMPLE);
      darkness[cell] = (darkness[cell] ?? 0) + (marked[sy * width + sx] ?? 0) / SUPERSAMPLE ** 2;
    }
  return darkness;
};

/** Grayscale on a material that darkens fast at low power. */
function materialBurn(sMax: number): Burn {
  // Float64Array.from, not .map: compiled power may be a Uint16Array, whose map
  // would round every darkness to 0 or 1.
  return (group) =>
    Float64Array.from(group.sValues, (value) => 1 - (1 - Math.min(1, value / sMax)) ** 2.5);
}

/** Generate the wedge with the photo's settings, burn it, record it, fit the curve. */
function calibrate(operation: Layer, burn: Burn): PhotoToneCurve {
  const wedge = generateToneCalibrationWedge({ patchCount: 11, patchSizeMm: 6, operation });
  const wedgeOperation = wedge.scene.layers.find((layer) => layer.id === wedge.operationId);
  if (wedgeOperation === undefined) throw new Error('No wedge operation');
  const group = compile(wedge.scene.objects, wedgeOperation);
  const darkness = burn(group);
  const margin = 10; // keep clear of patch edges, where gaps and spill mix in
  const samples = wedge.patches.map((patch) => {
    const x0 = Math.round((patch.bounds.minX - group.bounds.minX) * LINES_PER_MM) + margin;
    const x1 = Math.round((patch.bounds.maxX - group.bounds.minX) * LINES_PER_MM) - margin;
    let sum = 0;
    let count = 0;
    for (let y = margin; y < group.pixelHeight - margin; y += 1)
      for (let x = x0; x < x1; x += 1) {
        sum += darkness[y * group.pixelWidth + x] ?? 0;
        count += 1;
      }
    return { commandedPercent: patch.commandedPercent, observedPercent: (100 * sum) / count };
  });
  return fitPhotoToneCurve(samples, 'Simulated material');
}

/** Mean absolute per-block darkness error, and the mean signed bias. */
function toneError(
  luma: Uint8Array,
  darkness: Float64Array,
): { readonly mae: number; readonly bias: number } {
  const blocks = PHOTO_PX / BLOCK_CELLS;
  let absolute = 0;
  let signed = 0;
  for (let by = 0; by < blocks; by += 1)
    for (let bx = 0; bx < blocks; bx += 1) {
      let target = 0;
      let burned = 0;
      for (let y = by * BLOCK_CELLS; y < (by + 1) * BLOCK_CELLS; y += 1)
        for (let x = bx * BLOCK_CELLS; x < (bx + 1) * BLOCK_CELLS; x += 1) {
          target += 1 - (luma[y * PHOTO_PX + x] ?? 255) / 255;
          burned += darkness[y * PHOTO_PX + x] ?? 0;
        }
      const difference = (burned - target) / BLOCK_CELLS ** 2;
      absolute += Math.abs(difference);
      signed += difference;
    }
  return { mae: absolute / blocks ** 2, bias: signed / blocks ** 2 };
}

function burnedPortrait(luma: Uint8Array, operation: Layer, burn: Burn): Float64Array {
  const group = compile([photoImage(luma)], operation);
  expect([group.pixelWidth, group.pixelHeight]).toEqual([PHOTO_PX, PHOTO_PX]);
  return burn(group);
}

describe('photo tone calibration — simulated burns', () => {
  const luma = photoLuma({ path: ASSET_PATH, width: PHOTO_PX, height: PHOTO_PX });

  it.each(['jarvis', 'stucki'] as const)(
    'a %s portrait with dot gain tracks the photo tones once calibrated',
    (dither) => {
      const curve = calibrate(photoOperation(dither), dotGainBurn);
      const plain = toneError(luma, burnedPortrait(luma, photoOperation(dither), dotGainBurn));
      const calibrated = toneError(
        luma,
        burnedPortrait(luma, photoOperation(dither, curve), dotGainBurn),
      );
      // Uncalibrated dot gain burns visibly too dark...
      expect(plain.bias).toBeGreaterThan(0.12);
      // ...and the wedge's own curve removes most of the tone error and bias.
      expect(calibrated.mae).toBeLessThan(plain.mae * 0.2);
      expect(Math.abs(calibrated.bias)).toBeLessThan(plain.bias * 0.1);
    },
    BUDGET_MS,
  );

  it(
    'a grayscale portrait on a fast-darkening material tracks the photo tones once calibrated',
    () => {
      // Full power is what a solid black photo compiles to.
      const black = new Uint8Array(PHOTO_PX * PHOTO_PX);
      const sMax = Math.max(...compile([photoImage(black)], photoOperation('grayscale')).sValues);
      const burnAtPower = materialBurn(sMax);
      const curve = calibrate(photoOperation('grayscale'), burnAtPower);
      const plain = toneError(luma, burnedPortrait(luma, photoOperation('grayscale'), burnAtPower));
      const calibrated = toneError(
        luma,
        burnedPortrait(luma, photoOperation('grayscale', curve), burnAtPower),
      );
      expect(plain.bias).toBeGreaterThan(0.12);
      expect(calibrated.mae).toBeLessThan(plain.mae * 0.1);
    },
    BUDGET_MS,
  );
});
