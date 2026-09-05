import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import { compileJob } from './compile-job';
import { generateIntervalTestGrid } from './interval-test-grid';
import { generateMaterialTestGrid } from './material-test-grid';

describe('calibration numeric feed normalization', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'keeps %s numeric input executable in both generator APIs',
    (speed) => {
      const interval = generateIntervalTestGrid({
        steps: 2,
        speed,
        power: 25,
        intervalMinMm: 0.1,
        intervalMaxMm: 0.2,
        swatchSizeMm: 2,
      });
      const material = generateMaterialTestGrid({
        rows: 2,
        columns: 2,
        speedMin: speed,
        speedMax: 1000,
        powerMin: 10,
        powerMax: 25,
        cellWidthMm: 2,
        cellHeightMm: 2,
      });
      expect(interval.cells.every((cell) => cell.speed >= 1)).toBe(true);
      expect(material.cells.every((cell) => cell.speed >= 1)).toBe(true);
      for (const grid of [interval, material]) {
        expect(() =>
          grblStrategy.emit(compileJob(grid.scene, DEFAULT_DEVICE_PROFILE), DEFAULT_DEVICE_PROFILE),
        ).not.toThrow();
      }
    },
  );
});
