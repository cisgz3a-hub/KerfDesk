import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { prepareImageLuma } from '../raster/image-processing';
import { fitPhotoToneCurve } from '../raster/photo-tone-curve';
import { decodeRasterLuma } from './raster-luma-decode';
import { createLayer, type Layer, type RasterImage } from '../scene';
import { compileRasterGroupsForLayer } from './compile-job-raster';
import {
  generateToneCalibrationWedge,
  toneWedgeBurnLumas,
  toneWedgeCommandedPercents,
} from './tone-calibration-wedge';

const PHOTO: Layer = {
  ...createLayer({ id: 'photo', color: '#808080', mode: 'image' }),
  ditherAlgorithm: 'jarvis',
  linesPerMm: 10,
  power: 40,
  speed: 3000,
  dotWidthCorrectionMm: 0.02,
  photoToneCurve: fitPhotoToneCurve([{ commandedPercent: 50, observedPercent: 80 }], 'Birch'),
};

function wedgeImage(wedge: ReturnType<typeof generateToneCalibrationWedge>): RasterImage {
  const image = wedge.scene.objects.find((object) => object.kind === 'raster-image');
  if (image?.kind !== 'raster-image') throw new Error('Missing wedge image');
  return image;
}

function decodedLuma(image: RasterImage): Uint8Array {
  return decodeRasterLuma(image);
}

describe('ADR-670 tone calibration wedge', () => {
  it('spaces the patches evenly from blank to solid, as whole burn lumas', () => {
    expect(toneWedgeBurnLumas(11)).toEqual([255, 230, 204, 179, 153, 128, 102, 77, 51, 25, 0]);
    const commanded = toneWedgeCommandedPercents(16);
    expect(commanded).toHaveLength(16);
    expect(commanded[0]).toBe(0);
    expect(commanded[15]).toBe(100);
    expect(toneWedgeBurnLumas(2)).toHaveLength(6);
    expect(toneWedgeBurnLumas(99)).toHaveLength(21);
  });

  it("burns on one Image operation with the photo's settings but without its curve", () => {
    const wedge = generateToneCalibrationWedge({
      patchCount: 11,
      patchSizeMm: 8,
      operation: PHOTO,
    });
    const operation = wedge.scene.layers.find((layer) => layer.id === wedge.operationId);
    expect(operation).toMatchObject({
      mode: 'image',
      ditherAlgorithm: 'jarvis',
      linesPerMm: 10,
      power: 40,
      speed: 3000,
      dotWidthCorrectionMm: 0.02,
      passThrough: false,
    });
    expect(operation).not.toHaveProperty('photoToneCurve');
    expect(wedge.patches.map((patch) => patch.label)).toEqual(COMMANDED_LABELS);
    const labels = wedge.scene.objects.filter((object) => object.kind === 'imported-svg');
    expect(labels).toHaveLength(11);
    for (const [index, patch] of wedge.patches.entries()) {
      expect(patch.bounds.maxX - patch.bounds.minX).toBe(8);
      expect(labels[index]?.transform.y).toBeGreaterThan(patch.bounds.maxY);
    }
  });

  it('gives the ditherer the same burn lumas on light-marking material', () => {
    const dark = generateToneCalibrationWedge({ patchCount: 11, patchSizeMm: 5, operation: PHOTO });
    const light = generateToneCalibrationWedge({
      patchCount: 11,
      patchSizeMm: 5,
      operation: { ...PHOTO, negativeImage: true },
    });
    const darkImage = wedgeImage(dark);
    const lightImage = wedgeImage(light);
    const darkOperation = dark.scene.layers[0];
    const lightOperation = light.scene.layers[0];
    if (darkOperation === undefined || lightOperation === undefined)
      throw new Error('No operation');
    expect(prepareImageLuma(decodedLuma(lightImage), lightImage, lightOperation)).toEqual(
      prepareImageLuma(decodedLuma(darkImage), darkImage, darkOperation),
    );
  });

  it('compiles patch dot density rising with the commanded tone', () => {
    const wedge = generateToneCalibrationWedge({
      patchCount: 11,
      patchSizeMm: 5,
      operation: PHOTO,
    });
    const operation = wedge.scene.layers[0];
    if (operation === undefined) throw new Error('No operation');
    const compiled = compileRasterGroupsForLayer(
      wedge.scene.objects,
      operation,
      DEFAULT_DEVICE_PROFILE,
    );
    const group = compiled.groups[0];
    if (group === undefined) throw new Error('No raster group');
    const densities = wedge.patches.map((patch) => {
      const x0 = Math.ceil((patch.bounds.minX - group.bounds.minX) * 10) + 1;
      const x1 = Math.floor((patch.bounds.maxX - group.bounds.minX) * 10) - 1;
      let fired = 0;
      let total = 0;
      for (let y = 2; y < group.pixelHeight - 2; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          total += 1;
          if ((group.sValues[y * group.pixelWidth + x] ?? 0) > 0) fired += 1;
        }
      }
      return fired / total;
    });
    expect(densities[0]).toBe(0);
    expect(densities[10]).toBe(1);
    for (let index = 1; index < densities.length; index += 1)
      expect(densities[index]).toBeGreaterThan(densities[index - 1] ?? 0);
    for (const [index, density] of densities.entries())
      expect(Math.abs(density - (wedge.patches[index]?.commandedPercent ?? 0) / 100)).toBeLessThan(
        0.06,
      );
  });
});

const COMMANDED_LABELS = ['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'];
