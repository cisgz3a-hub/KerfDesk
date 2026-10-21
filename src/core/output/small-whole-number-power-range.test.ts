// ADR-567 Amendment 1 (audit 03-P2-4): a small whole-number $30 such as 1 or
// 20 used to round every percentage to S0 or full power, while Job Review
// showed the set percentage. Power-scale version 3 gives such ranges the
// virtual fractional range; 100 S steps or more keep their whole-S bytes.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { compileJob } from '../job/compile-job';
import type { CutGroup, Job, RasterGroup } from '../job';
import { createLayer, IDENTITY_TRANSFORM, type RasterImage } from '../scene';
import { rescaleRasterValuesForVersion } from '../raster/controller-power-scale';
import { grblStrategy } from './grbl-strategy';
import { scaleS } from './grbl-laser-lines';
import { CURRENT_LASER_POWER_SCALE_VERSION } from './laser-power-scale-version';

function line(power: number): CutGroup {
  return {
    kind: 'cut',
    layerId: `line-${power}`,
    color: '#000000',
    power,
    speed: 1200,
    passes: 1,
    airAssist: false,
    segments: [
      {
        closed: false,
        polyline: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
        ],
      },
    ],
  };
}

function burnS(gcode: string): ReadonlyArray<string> {
  return gcode
    .split('\n')
    .filter((text) => text.startsWith('G1 X30.000 Y10.000'))
    .map((text) => /S([\d.]+)/.exec(text)?.[1] ?? 'none');
}

// Luma 0x00 (black), 0x80 (mid) and 0xFF (white) in one row.
const grayRow: RasterImage = {
  kind: 'raster-image',
  id: 'R1',
  source: 'photo.png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  lumaBase64: 'AID/',
  pixelWidth: 3,
  pixelHeight: 1,
  bounds: { minX: 0, minY: 0, maxX: 3, maxY: 1 },
  transform: IDENTITY_TRANSFORM,
  color: '#808080',
  dither: 'threshold',
  linesPerMm: 1,
};

function grayscaleRaster(
  maxPowerS: number,
  version = CURRENT_LASER_POWER_SCALE_VERSION,
  image: { readonly lumaBase64: string; readonly power: number; readonly minPower: number } = {
    lumaBase64: 'AID/',
    power: 30,
    minPower: 10,
  },
): Job {
  const layer = {
    ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
    ditherAlgorithm: 'grayscale' as const,
    linesPerMm: 1,
    minPower: image.minPower,
    power: image.power,
  };
  return compileJob(
    { objects: [{ ...grayRow, lumaBase64: image.lumaBase64 }], layers: [layer] },
    { ...DEFAULT_DEVICE_PROFILE, maxPowerS },
    version,
  );
}

function rasterValues(job: Job): ReadonlyArray<number> {
  const group = job.groups[0];
  if (group?.kind !== 'raster') throw new Error('expected one raster group');
  return Array.from((group as RasterGroup).sValues);
}

describe('small whole-number $30 power range', () => {
  it('scales vector power in the virtual range below 100 S steps', () => {
    expect([30, 50, 70, 100].map((power) => scaleS(power, 1))).toEqual([0.3, 0.5, 0.7, 1]);
    expect(scaleS(33, 2)).toBe(0.66);
    expect(scaleS(33, 20)).toBe(6.6);
    expect(scaleS(12.5, 99)).toBe(12.375);
  });

  it('keeps whole-S rounding from 100 S steps up, byte for byte', () => {
    expect(scaleS(12.5, 100)).toBe(13);
    expect(scaleS(50, 255)).toBe(128);
    expect(scaleS(33.3, 1000)).toBe(333);
  });

  it('keeps archived versions 1 and 2 at their original rounding', () => {
    expect([30, 50].map((power) => scaleS(power, 1, 2))).toEqual([0, 1]);
    expect([30, 50].map((power) => scaleS(power, 1, 1))).toEqual([0, 1]);
  });

  it('emits each Line at its own share of a $30=1 range', () => {
    const device = { ...DEFAULT_DEVICE_PROFILE, maxPowerS: 1 };
    const gcode = grblStrategy.emit({ groups: [line(30), line(50), line(100)] }, device);
    expect(burnS(gcode)).toEqual(['0.3', '0.5', '1']);
    expect(gcode).toContain('power 50%');
  });

  it('emits the same vector bytes as before for $30=1000 and $30=255', () => {
    for (const maxPowerS of [1000, 255]) {
      const device = { ...DEFAULT_DEVICE_PROFILE, maxPowerS };
      const job = { groups: [line(30), line(50)] };
      expect(grblStrategy.emit(job, device)).toBe(
        grblStrategy.emit(job, device, { laserPowerScaleVersion: 2 }),
      );
    }
  });

  it('keeps a 30% grayscale image at its shares of a $30=1 range', () => {
    expect(rasterValues(grayscaleRaster(1))).toEqual([0.3, 0.2, 0]);
    // Version 2 rounded every pixel of the same image to S0.
    expect(rasterValues(grayscaleRaster(1, 2))).toEqual([0, 0, 0]);
    const gcode = grblStrategy.emit(grayscaleRaster(1), {
      ...DEFAULT_DEVICE_PROFILE,
      maxPowerS: 1,
    });
    expect(gcode).toMatch(/S0\.3\b/);
    expect(gcode).toMatch(/S0\.2\b/);
  });

  it('spells rescaled raster samples to twelve significant digits', () => {
    // Luma 0x10 compiles to 937 of 1000; 937 / 1000 * 20 is 18.740000000000002.
    const image = { lumaBase64: 'EID/', power: 100, minPower: 0 };
    expect(rasterValues(grayscaleRaster(20, 3, image))).toEqual([18.74, 9.96, 0]);
    expect(rescaleRasterValuesForVersion(Float64Array.of(937), 1000, 20, 2)[0]).toBe(
      18.740000000000002,
    );
    const gcode = grblStrategy.emit(grayscaleRaster(20, 3, image), {
      ...DEFAULT_DEVICE_PROFILE,
      maxPowerS: 20,
    });
    expect(gcode).toMatch(/S18\.74\b/);
    expect(gcode).not.toMatch(/S\d+\.\d{6,}/);
  });

  it('keeps $30=1000 and $30=255 raster values in whole S', () => {
    expect(rasterValues(grayscaleRaster(1000))).toEqual([300, 200, 0]);
    expect(rasterValues(grayscaleRaster(255))).toEqual(rasterValues(grayscaleRaster(255, 2)));
  });
});
