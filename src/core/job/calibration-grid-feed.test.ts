import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import { compileJob } from './compile-job';
import { generateIntervalTestGrid } from './interval-test-grid';
import { generateMaterialTestGrid } from './material-test-grid';

describe('calibration numeric feed normalization', () => {
  it.each([
    { requested: 1234.9, ceiling: 2000, expected: 1234 },
    { requested: 2000, ceiling: 1234.9, expected: 1234 },
    { requested: 2000, ceiling: 0.25, expected: 0.25 },
    { requested: 2000, ceiling: 0.125, expected: 0.125 },
    { requested: 2000, ceiling: 0.001, expected: 0.001 },
  ])(
    'reports the represented feed for $requested with ceiling $ceiling',
    ({ requested, ceiling, expected }) => {
      const interval = generateIntervalTestGrid({
        steps: 1,
        speed: requested,
        maxFeedMmPerMin: ceiling,
        power: 25,
        intervalMinMm: 0.1,
        intervalMaxMm: 0.2,
        swatchSizeMm: 2,
      });
      const material = generateMaterialTestGrid({
        rows: 1,
        columns: 1,
        speedMin: requested,
        speedMax: requested,
        maxFeedMmPerMin: ceiling,
        powerMin: 10,
        powerMax: 25,
        cellWidthMm: 2,
        cellHeightMm: 2,
      });
      for (const grid of [interval, material]) {
        expect(grid.cells[0]?.requestedSpeed).toBe(requested);
        expect(grid.cells[0]?.effectiveSpeed).toBe(expected);
        expect(grid.cells[0]?.speed).toBe(expected);
        const profile = { ...DEFAULT_DEVICE_PROFILE, maxFeed: ceiling };
        const output = grblStrategy.emit(compileJob(grid.scene, profile), profile);
        const emittedFeeds = [...output.matchAll(/\bF(\d+(?:\.\d+)?)/g)].map((match) =>
          Number(match[1]),
        );
        expect(emittedFeeds).toContain(expected);
        expect(
          grid.scene.objects.some(
            (object) =>
              object.kind === 'imported-svg' && object.source === `calibration-label:${expected}`,
          ),
        ).toBe(true);
        expect(grid.scene.layers[0]?.name).toContain(`${expected} effective mm/min`);
      }
    },
  );

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
