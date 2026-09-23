import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import { createLayer, IDENTITY_TRANSFORM, type RasterImage, type SceneObject } from '../scene';
import { compileJob } from './compile-job';
import type * as RasterBudget from '../raster/raster-budget';

// Exercise both materialized (one row) and streamed (two rows) compilation with
// the same independently specified five-grey ramp, without allocating huge images.
vi.mock('../raster/raster-budget', async (original) => ({
  ...(await original<typeof RasterBudget>()),
  STREAMED_RASTER_PIXEL_THRESHOLD: 5,
}));

const device = { ...DEFAULT_DEVICE_PROFILE, maxPowerS: 1000 };
const layer = {
  ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
  power: 100,
  passThrough: true,
};
function image(height: number): RasterImage {
  return {
    kind: 'raster-image',
    id: 'ramp',
    source: 'ramp.png',
    dataUrl: 'data:image/png;base64,unused',
    pixelWidth: 5,
    pixelHeight: height,
    bounds: { minX: 10, minY: 10, maxX: 15, maxY: 10 + height },
    transform: IDENTITY_TRANSFORM,
    color: layer.color,
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: Buffer.from(
      Array.from({ length: height }, () => [0, 64, 128, 192, 255]).flat(),
    ).toString('base64'),
  };
}

describe('original-pixels raster output', () => {
  it.each([1, 2])(
    'ignores preparation controls in %i-row compilation and emitted G-code',
    (height) => {
      const source = image(height);
      const operation = { ...layer, minPower: 20, dotWidthCorrectionMm: 0.25 };
      const neutral = compileJob({ objects: [source], layers: [operation] }, device);
      const adjusted = compileJob(
        {
          objects: [{ ...source, brightness: 100, contrast: -90, gamma: 4 }],
          layers: [
            {
              ...operation,
              ditherAlgorithm: 'jarvis',
              negativeImage: true,
              linesPerMm: 25,
            },
          ],
        },
        device,
      );
      for (const job of [neutral, adjusted]) {
        const raster = job.groups[0];
        if (raster?.kind !== 'raster') throw new Error('missing raster');
        expect(raster.pixelWidth).toBe(5);
        expect(raster.pixelHeight).toBe(height);
        expect(raster.dotWidthCorrectionMm).toBe(0.25);
        expect(Array.from(raster.rowProvider?.(0) ?? raster.sValues)).toEqual([
          1000, 799, 598, 398, 0,
        ]);
      }
      const emit = (job: typeof neutral) =>
        grblStrategy.emit(job, device, { compactMotionWords: false, finishPosition: null });
      const gcode = emit(adjusted);
      expect(gcode).toBe(emit(neutral));
      for (const power of [1000, 799, 598, 398])
        expect(gcode).toMatch(new RegExp(`G1[^\\n]* S${power}(?: |\\n)`));
      // The four one-millimetre grey runs each retain a half-millimetre burn
      // after the selected quarter-millimetre correction at both ends.
      expect(poweredXLengths(gcode)).toEqual(new Array<number>(height * 4).fill(0.5));
      expect(gcode).toContain('M5');
    },
  );

  it.each([1, 2])('retains mask boundaries and grey values with %i rows', (height) => {
    const mask: SceneObject = {
      kind: 'imported-svg',
      id: 'mask',
      source: 'mask.svg',
      transform: IDENTITY_TRANSFORM,
      bounds: { minX: 11, minY: 10, maxX: 14, maxY: 10 + height },
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: true,
              points: [
                { x: 11, y: 10 },
                { x: 14, y: 10 },
                { x: 14, y: 10 + height },
                { x: 11, y: 10 + height },
                { x: 11, y: 10 },
              ],
            },
          ],
        },
      ],
    };
    const job = compileJob(
      {
        objects: [{ ...image(height), imageMaskId: mask.id, brightness: 100 }, mask],
        layers: [{ ...layer, negativeImage: true }],
      },
      device,
    );
    const raster = job.groups[0];
    if (raster?.kind !== 'raster') throw new Error('missing raster');
    for (let row = 0; row < height; row += 1) {
      expect(
        Array.from(raster.rowProvider?.(row) ?? raster.sValues.slice(row * 5, (row + 1) * 5)),
      ).toEqual([0, 749, 498, 247, 0]);
    }
  });

  it('still applies placement mirrors and the operation power range', () => {
    const source = image(1);
    const job = compileJob(
      {
        objects: [{ ...source, transform: { ...source.transform, mirrorX: true } }],
        layers: [{ ...layer, power: 50, minPower: 40 }],
      },
      device,
    );
    const raster = job.groups[0];
    if (raster?.kind !== 'raster') throw new Error('missing raster');
    expect(Array.from(raster.sValues)).toEqual([0, 425, 450, 475, 500]);
  });
});

function poweredXLengths(gcode: string): number[] {
  const lengths: number[] = [];
  let x = 0;
  let power = 0;
  for (const line of gcode.split('\n')) {
    if (!/^G[01]\b/.test(line)) continue;
    const coordinate = line.match(/\bX(-?[\d.]+)/)?.[1];
    const outputPower = line.match(/\bS([\d.]+)/)?.[1];
    const next = coordinate === undefined ? x : Number(coordinate);
    if (outputPower !== undefined) power = Number(outputPower);
    if (/^G1\b/.test(line) && power > 0 && next !== x) lengths.push(Math.abs(next - x));
    x = next;
  }
  return lengths;
}
