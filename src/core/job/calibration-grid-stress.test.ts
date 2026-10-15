import { describe, expect, it } from 'vitest';
import { generateMaterialTestGrid } from './material-test-grid';
import { generateIntervalTestGrid } from './interval-test-grid';
import { generateScanOffsetCalibrationPattern } from './scan-offset-calibration-pattern';

describe('calibration generators at their supported count limits', () => {
  it('keeps all 400 material cells finite, unique and ordered across both speed axis choices', () => {
    for (const rowParameter of ['speed', 'power'] as const) {
      const result = generateMaterialTestGrid({
        rows: 10000,
        columns: 10000,
        rowParameter,
        columnParameter: rowParameter === 'speed' ? 'power' : 'speed',
        speedMin: 1,
        speedMax: 12000,
        powerMin: 0,
        powerMax: 100,
        cellWidthMm: 1,
        cellHeightMm: 1,
        accelMmPerSec2: 100,
      });
      expect(result.cells).toHaveLength(400);
      expect(new Set(result.cells.map((cell) => cell.objectId)).size).toBe(400);
      expect(result.cells[0]?.speed).toBe(12000);
      expect(result.cells[0]?.power).toBe(0);
      expect(result.cells.at(-1)?.speed).toBe(1);
      expect(result.cells.at(-1)?.power).toBe(100);
      expect(result.cells.every((cell) => Object.values(cell.bounds).every(Number.isFinite))).toBe(
        true,
      );
    }
  });

  it('bounds huge requested swatch counts without losing interval or scan-speed endpoints', () => {
    const interval = generateIntervalTestGrid({
      steps: 1000000,
      speed: 12000.9,
      power: 50,
      intervalMinMm: 0.05,
      intervalMaxMm: 1,
      swatchSizeMm: 1,
    });
    expect(interval.cells).toHaveLength(20);
    expect(interval.cells[0]?.intervalMm).toBe(1);
    expect(interval.cells.at(-1)?.intervalMm).toBe(0.05);
    expect(interval.cells.every((cell) => cell.effectiveSpeed === 12000)).toBe(true);
    const scan = generateScanOffsetCalibrationPattern({
      steps: 1000000,
      speedMin: 1,
      speedMax: 12000.9,
      power: 50,
      swatchWidthMm: 1,
      swatchHeightMm: 1,
    });
    expect(scan.cells).toHaveLength(10);
    expect(scan.cells[0]?.speed).toBe(12000);
    expect(scan.cells.at(-1)?.speed).toBe(1);
    for (const result of [interval, scan]) {
      expect(new Set(result.cells.map((cell) => cell.objectId)).size).toBe(result.cells.length);
      expect(result.cells.every((cell) => Object.values(cell.bounds).every(Number.isFinite))).toBe(
        true,
      );
    }
  });
});
