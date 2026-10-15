import { expect, it } from 'vitest';
import { generateIntervalTestGrid } from './interval-test-grid';
import { formatCalibrationInterval } from './calibration-labels';

it.each([
  { swatchSizeMm: 8, gapMm: 2 },
  { swatchSizeMm: 8, gapMm: 0 },
  { swatchSizeMm: 1, gapMm: 0 },
])(
  'keeps full-precision labels inside $swatchSizeMm mm swatches with $gapMm mm gaps',
  ({ swatchSizeMm, gapMm }) => {
    const grid = generateIntervalTestGrid({
      steps: 10,
      speed: 1500,
      power: 20,
      intervalMinMm: 0.08,
      intervalMaxMm: 0.2,
      swatchSizeMm,
      gapMm,
    });
    for (const cell of grid.cells) {
      const label = grid.scene.objects.find(
        (object) => object.id === `interval-test-label-${cell.step}`,
      )!;
      expect(label.kind === 'imported-svg' && label.source).toBe(
        `calibration-label:${formatCalibrationInterval(cell.intervalMm)}`,
      );
      expect(label.transform.x + label.bounds.minX).toBeGreaterThanOrEqual(cell.bounds.minX - 1e-9);
      expect(label.transform.x + label.bounds.maxX).toBeLessThanOrEqual(cell.bounds.maxX + 1e-9);
    }
  },
);
