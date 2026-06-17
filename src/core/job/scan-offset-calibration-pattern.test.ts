import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { compileJob } from './compile-job';
import { generateScanOffsetCalibrationPattern } from './scan-offset-calibration-pattern';

describe('generateScanOffsetCalibrationPattern', () => {
  it('creates bidirectional fill swatches from fastest to slowest speed', () => {
    const pattern = generateScanOffsetCalibrationPattern({
      steps: 3,
      speedMin: 1000,
      speedMax: 3000,
      power: 12,
      swatchWidthMm: 18,
      swatchHeightMm: 6,
      hatchSpacingMm: 0.5,
      overscanMm: 4,
      gapMm: 2,
      origin: { x: 5, y: 7 },
    });

    expect(pattern.scene.layers).toHaveLength(3);
    expect(pattern.scene.objects).toHaveLength(3);
    expect(pattern.cells.map((cell) => cell.speed)).toEqual([3000, 2000, 1000]);
    expect(pattern.cells.map((cell) => cell.bounds)).toEqual([
      { minX: 5, minY: 7, maxX: 23, maxY: 13 },
      { minX: 25, minY: 7, maxX: 43, maxY: 13 },
      { minX: 45, minY: 7, maxX: 63, maxY: 13 },
    ]);

    expect(pattern.scene.layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'scan-offset-calibration-step-0',
          mode: 'fill',
          speed: 3000,
          power: 12,
          fillBidirectional: true,
          fillCrossHatch: false,
          fillOverscanMm: 4,
          hatchAngleDeg: 0,
          hatchSpacingMm: 0.5,
        }),
      ]),
    );
  });

  it('compiles every speed swatch with forward and reverse fill sweeps', () => {
    const pattern = generateScanOffsetCalibrationPattern({
      steps: 2,
      speedMin: 1000,
      speedMax: 2000,
      power: 10,
      swatchWidthMm: 12,
      swatchHeightMm: 4,
      hatchSpacingMm: 1,
    });

    const job = compileJob(pattern.scene, DEFAULT_DEVICE_PROFILE);
    const fillGroups = job.groups.filter((group) => group.kind === 'fill');

    expect(fillGroups.map((group) => group.speed)).toEqual([2000, 1000]);
    for (const group of fillGroups) {
      expect(group.segments.some((segment) => segment.reverse === false)).toBe(true);
      expect(group.segments.some((segment) => segment.reverse === true)).toBe(true);
    }
  });
});
