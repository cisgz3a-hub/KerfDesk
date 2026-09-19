import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { compileRasterGroupsForLayer } from '../job/compile-job-raster';
import type { RasterGroup } from '../job';
import { createLayer, createProject, IDENTITY_TRANSFORM, type DitherAlgorithm } from '../scene';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { smoothiewareStrategy } from './smoothieware-strategy';
import { encodeCanonicalBase64 } from '../relief/depth-map-base64';
import type * as RasterBudgetModule from '../raster/raster-budget';

vi.mock('../raster/raster-budget', async (importOriginal) => ({
  ...(await importOriginal<typeof RasterBudgetModule>()),
  STREAMED_RASTER_PIXEL_THRESHOLD: 4,
}));

const DEVICE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'smoothieware',
  maxPowerS: 1,
};

function imageProject(power: number, algorithm: DitherAlgorithm, pixels = [0], maxPowerS = 1) {
  const base = createProject({ ...DEVICE, maxPowerS });
  return {
    ...base,
    scene: {
      ...base.scene,
      layers: [
        {
          ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
          power,
          ditherAlgorithm: algorithm,
          linesPerMm: 1,
        },
      ],
      objects: [
        {
          kind: 'raster-image' as const,
          id: 'r',
          source: 'photo.png',
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          pixelWidth: pixels.length,
          pixelHeight: 1,
          bounds: { minX: 10, minY: 10, maxX: 10 + pixels.length, maxY: 11 },
          transform: IDENTITY_TRANSFORM,
          color: '#808080',
          dither: algorithm,
          linesPerMm: 1,
          lumaBase64: encodeCanonicalBase64(Uint8Array.from(pixels)),
        },
      ],
    },
  };
}

function powerWords(gcode: string): number[] {
  return gcode
    .split('\n')
    .filter((line) => /^G1\b/.test(line))
    .flatMap((line) => {
      const value = /\bS([\d.]+)/.exec(line)?.[1];
      return value === undefined || Number(value) === 0 ? [] : [Number(value)];
    });
}

describe('Smoothieware original-unit raster power', () => {
  it.each([25, 50, 100])(
    'public output keeps %s percent on stored and streamed images',
    (power) => {
      for (const pixels of [[0], [0, 0, 0, 0, 0]]) {
        const result = emitGcode(imageProject(power, 'threshold', pixels));
        expect(result.preflight.issues).toEqual([]);
        expect(powerWords(result.gcode)).toEqual([power / 100]);
      }
    },
  );

  it.each([
    'threshold',
    'ordered',
    'grayscale',
    'floyd-steinberg',
    'jarvis',
    'stucki',
    'atkinson',
    'burkes',
    'sierra3',
    'sierra2',
    'sierra-lite',
  ] as const)('%s preserves fractional full-burn pixels in both compilation paths', (algorithm) => {
    for (const pixels of [[0], [0, 0, 0, 0, 0]]) {
      const project = imageProject(25, algorithm, pixels);
      const compiled = compileRasterGroupsForLayer(
        project.scene.objects,
        project.scene.layers[0]!,
        project.device,
      );
      const group = compiled.groups[0]!;
      const values = group.rowProvider?.(0) ?? group.sValues;
      expect(Array.from(values)).toEqual(pixels.map(() => 0.25));
      expect(group.rowProvider === undefined).toBe(pixels.length <= 4);
    }
  });

  it.each([0.1, 1, 100])('grayscale keeps tones and minimum power at S max %s', (maxPowerS) => {
    for (const pixels of [
      [0, 128, 255],
      [0, 128, 255, 255, 255],
    ]) {
      const project = imageProject(25, 'grayscale', pixels, maxPowerS);
      const layer = { ...project.scene.layers[0]!, minPower: 10 };
      const result = emitGcode({ ...project, scene: { ...project.scene, layers: [layer] } });
      expect(result.preflight.issues).toEqual([]);
      const powers = powerWords(result.gcode);
      expect(powers).toHaveLength(2);
      expect(powers[0]).toBeCloseTo(maxPowerS * 0.25, 6);
      expect(powers[1]).toBeCloseTo(maxPowerS * 0.175, 6);
    }
  });

  it('rescales original-unit rows once without mutating or eagerly consuming them', () => {
    const values = Float64Array.of(0.25, 0.5, 1);
    const group: RasterGroup = {
      kind: 'raster',
      layerId: 'image',
      color: '#808080',
      power: 100,
      speed: 1500,
      passes: 2,
      airAssist: false,
      sValues: values,
      pixelWidth: 3,
      pixelHeight: 1,
      bounds: { minX: 10, minY: 10, maxX: 13, maxY: 11 },
      overscanMm: 0,
      dotWidthCorrectionMm: 0,
    };
    const materialized = smoothiewareStrategy.emit({ groups: [group] }, DEVICE);
    const rowProvider = vi.fn(() => values);
    const streamed = smoothiewareStrategy.emit(
      { groups: [{ ...group, sValues: new Float64Array(), rowProvider }] },
      DEVICE,
    );
    expect(streamed).toBe(materialized);
    expect(powerWords(streamed)).toEqual([0.25, 0.5, 1, 0.25, 0.5, 1]);
    expect(rowProvider.mock.calls).toEqual([[0], [0]]);
    expect(Array.from(values)).toEqual([0.25, 0.5, 1]);
  });
});
