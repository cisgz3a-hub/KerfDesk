import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyPhotoToneCurve,
  evaluatePhotoToneCurve,
  fitPhotoToneCurve,
  IDENTITY_PHOTO_TONE_CURVE,
  isPhotoToneCurve,
  lumaToPercent,
  percentToLuma,
  photoToneCurveLut,
  photoToneCurvesEqual,
  poolAdjacentViolators,
  type PhotoToneCurve,
  type PhotoToneSample,
} from './photo-tone-curve';
import { prepareImageLuma } from './image-processing';

const COMMANDED = Array.from({ length: 11 }, (_, index) => index * 10);

function recorded(response: (commanded: number) => number): PhotoToneSample[] {
  return COMMANDED.map((commandedPercent) => ({
    commandedPercent,
    observedPercent: response(commandedPercent),
  }));
}

// Dot gain: a burned dot covers more than its cell, so every tone burns darker.
const dotGain = (commanded: number): number => 100 * (1 - (1 - commanded / 100) ** 2.2);

function expectMonotonic(curve: PhotoToneCurve): void {
  expect(isPhotoToneCurve(curve)).toBe(true);
  const lut = photoToneCurveLut(curve);
  expect(lut[0]).toBe(0);
  expect(lut[255]).toBe(255);
  for (let level = 1; level < 256; level += 1) {
    expect(lut[level]).toBeGreaterThanOrEqual(lut[level - 1] ?? 0);
  }
}

describe('ADR-670 photo tone curve fitting', () => {
  it('fits an identity record to an identity curve', () => {
    const curve = fitPhotoToneCurve(
      recorded((commanded) => commanded),
      'Paper',
    );
    expectMonotonic(curve);
    const lut = photoToneCurveLut(curve);
    for (let level = 0; level < 256; level += 1) {
      expect(Math.abs((lut[level] ?? 0) - level)).toBeLessThanOrEqual(1);
    }
  });

  it('inverts dot gain so the burned response lands on the target tone', () => {
    const curve = fitPhotoToneCurve(recorded(dotGain), 'Birch');
    expectMonotonic(curve);
    for (let target = 5; target <= 95; target += 5) {
      const commanded = lumaToPercent(evaluatePhotoToneCurve(curve, percentToLuma(target)));
      expect(commanded).toBeLessThan(target);
      // Piecewise-linear between 10 % patches: within a few percent of target.
      expect(Math.abs(dotGain(commanded) - target)).toBeLessThan(4);
    }
  });

  it('pools a non-monotonic record and still pins blank and solid', () => {
    const curve = fitPhotoToneCurve(
      [
        { commandedPercent: 0, observedPercent: 12 },
        { commandedPercent: 20, observedPercent: 45 },
        { commandedPercent: 30, observedPercent: 35 },
        { commandedPercent: 50, observedPercent: 70 },
        { commandedPercent: 100, observedPercent: 80 },
      ],
      'Noisy',
    );
    expectMonotonic(curve);
    expect(curve.points[0]).toEqual({ input: 0, output: 0 });
    expect(curve.points[curve.points.length - 1]).toEqual({ input: 255, output: 255 });
  });

  it('turns first-visible and first-solid runs into steep but finite steps', () => {
    const curve = fitPhotoToneCurve(
      recorded((commanded) => (commanded <= 20 ? 0 : commanded >= 70 ? 100 : (commanded - 20) * 2)),
      'Slate',
    );
    expectMonotonic(curve);
    // The faintest wanted tone already asks for the first visible patch's dots.
    expect(lumaToPercent(evaluatePhotoToneCurve(curve, 250))).toBeGreaterThan(5);
    // A nearly solid tone no longer needs more than the first solid patch.
    expect(lumaToPercent(evaluatePhotoToneCurve(curve, 5))).toBeLessThan(75);
  });

  it('keeps every random record monotonic and valid', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            commandedPercent: fc.double({ min: -10, max: 110, noNaN: true }),
            observedPercent: fc.double({ min: -10, max: 110, noNaN: true }),
          }),
          { maxLength: 40 },
        ),
        (samples) => {
          const curve = fitPhotoToneCurve(samples, 'random');
          const lut = photoToneCurveLut(curve);
          return (
            isPhotoToneCurve(curve) &&
            lut[0] === 0 &&
            lut[255] === 255 &&
            lut.every((value, level) => level === 0 || value >= (lut[level - 1] ?? 0))
          );
        },
      ),
      { numRuns: 150 },
    );
  });

  it('pools adjacent violators to the least-squares non-decreasing fit', () => {
    expect(poolAdjacentViolators([1, 3, 2, 4])).toEqual([1, 2.5, 2.5, 4]);
    expect(poolAdjacentViolators([5, 4, 3])).toEqual([4, 4, 4]);
    expect(poolAdjacentViolators([])).toEqual([]);
  });
});

describe('ADR-670 photo tone curve validation', () => {
  const valid = fitPhotoToneCurve(recorded(dotGain), 'Birch');

  it.each([
    [
      'unpinned blank end',
      {
        ...valid,
        points: [
          { input: 0, output: 0 },
          { input: 255, output: 250 },
        ],
      },
    ],
    [
      'unpinned solid end',
      {
        ...valid,
        points: [
          { input: 0, output: 4 },
          { input: 255, output: 255 },
        ],
      },
    ],
    [
      'falling output',
      {
        ...valid,
        points: [
          { input: 0, output: 0 },
          { input: 100, output: 120 },
          { input: 200, output: 110 },
          { input: 255, output: 255 },
        ],
      },
    ],
    [
      'repeated input',
      {
        ...valid,
        points: [
          { input: 0, output: 0 },
          { input: 100, output: 90 },
          { input: 100, output: 95 },
          { input: 255, output: 255 },
        ],
      },
    ],
    ['one point', { ...valid, points: [{ input: 0, output: 0 }] }],
    [
      'NaN',
      {
        ...valid,
        points: [
          { input: 0, output: 0 },
          { input: Number.NaN, output: 9 },
        ],
      },
    ],
    ['long label', { ...valid, label: 'x'.repeat(121) }],
    ['missing label', { points: valid.points }],
    ['array', [valid]],
  ])('rejects %s', (_name, value) => {
    expect(isPhotoToneCurve(value)).toBe(false);
  });

  it('accepts the identity curve and compares curves by value', () => {
    expect(isPhotoToneCurve(IDENTITY_PHOTO_TONE_CURVE)).toBe(true);
    expect(photoToneCurvesEqual(valid, structuredClone(valid))).toBe(true);
    expect(photoToneCurvesEqual(valid, { ...valid, label: 'Other' })).toBe(false);
    expect(photoToneCurvesEqual(valid, undefined)).toBe(false);
    expect(photoToneCurvesEqual(undefined, undefined)).toBe(true);
  });
});

describe('ADR-670 tone curve in the shared image path', () => {
  const settings = { passThrough: false, negativeImage: false, ditherAlgorithm: 'jarvis' } as const;
  const source = Uint8Array.from({ length: 256 }, (_, index) => index);
  const curve = fitPhotoToneCurve(recorded(dotGain), 'Birch');

  it('returns the same luma when no curve or the identity curve is set', () => {
    expect(applyPhotoToneCurve(source, undefined)).toBe(source);
    expect(applyPhotoToneCurve(source, IDENTITY_PHOTO_TONE_CURVE)).toBe(source);
    expect(prepareImageLuma(source, {}, settings)).toBe(source);
    expect(prepareImageLuma(source, {}, { ...settings, photoToneCurve: undefined })).toBe(source);
  });

  it('lightens midtones before dithering and keeps blank and solid', () => {
    const prepared = prepareImageLuma(source, {}, { ...settings, photoToneCurve: curve });
    expect(prepared[0]).toBe(0);
    expect(prepared[255]).toBe(255);
    expect(prepared[128]).toBeGreaterThan(128);
  });

  it('corrects the burn side after Negative, the same marks on light-marking material', () => {
    const negative = prepareImageLuma(
      source,
      {},
      { ...settings, negativeImage: true, photoToneCurve: curve },
    );
    const lut = photoToneCurveLut(curve);
    for (let level = 0; level < 256; level += 1) expect(negative[level]).toBe(lut[255 - level]);
  });

  it('leaves Pass-through pixels untouched', () => {
    expect(
      prepareImageLuma(source, {}, { ...settings, passThrough: true, photoToneCurve: curve }),
    ).toBe(source);
  });
});
