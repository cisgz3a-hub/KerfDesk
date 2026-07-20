import { describe, expect, it } from 'vitest';
import type { ImportedSvg } from '../scene';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
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

    // 3 fill swatches + 1 shared calibration-label layer.
    expect(pattern.scene.layers).toHaveLength(4);
    // 3 fill swatches + 3 burned speed labels.
    expect(pattern.scene.objects).toHaveLength(6);
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

    const job = compileJob(pattern.scene, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    const fillGroups = job.groups.filter((group) => group.kind === 'fill');

    expect(fillGroups.map((group) => group.speed)).toEqual([2000, 1000]);
    for (const group of fillGroups) {
      expect(group.segments.some((segment) => segment.reverse === false)).toBe(true);
      expect(group.segments.some((segment) => segment.reverse === true)).toBe(true);
      expect(group.bidirectionalScanOffsetMm).toBe(0);
      expect(group.scanDirection?.reason).toBe('calibration-baseline');
    }
  });

  it('lets verification coupons use the saved profile table instead of the zero override', () => {
    const pattern = generateScanOffsetCalibrationPattern({
      mode: 'verification',
      steps: 1,
      speedMin: 2000,
      speedMax: 2000,
      power: 10,
      swatchWidthMm: 12,
      swatchHeightMm: 4,
      hatchSpacingMm: 1,
    });
    const device = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      scanningOffsets: [{ speedMmPerMin: 2000, offsetMm: 0.2 }],
      scanOffsetCalibrationStatus: 'pending' as const,
    };

    const fill = compileJob(pattern.scene, device).groups.find((group) => group.kind === 'fill');

    expect(fill?.kind).toBe('fill');
    if (fill?.kind !== 'fill') throw new Error('Expected verification fill group');
    expect(fill.bidirectionalScanOffsetMm).toBeUndefined();
    expect(fill.scanDirection).toEqual({
      bidirectional: true,
      reason: 'calibration-verification',
    });
  });

  it('forces a truthful zero-offset baseline even when an old table exists', () => {
    const pattern = generateScanOffsetCalibrationPattern({
      mode: 'baseline',
      steps: 1,
      speedMin: 2000,
      speedMax: 2000,
      power: 10,
      swatchWidthMm: 12,
      swatchHeightMm: 4,
      hatchSpacingMm: 1,
    });
    const device = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      scanningOffsets: [{ speedMmPerMin: 2000, offsetMm: 0.2 }],
      scanOffsetCalibrationStatus: 'verified' as const,
    };

    const fill = compileJob(pattern.scene, device).groups.find((group) => group.kind === 'fill');

    expect(fill?.bidirectionalScanOffsetMm).toBe(0);
    expect(fill?.scanDirection).toEqual({
      bidirectional: true,
      reason: 'calibration-baseline',
    });
  });

  it('burns a speed label under each swatch so the apply UI can read it', () => {
    const pattern = generateScanOffsetCalibrationPattern({
      steps: 3,
      speedMin: 1000,
      speedMax: 3000,
      power: 12,
      swatchWidthMm: 18,
      swatchHeightMm: 6,
      gapMm: 2,
      origin: { x: 5, y: 7 },
    });

    const labels = pattern.scene.objects.filter(
      (object): object is ImportedSvg =>
        object.kind === 'imported-svg' && object.source.startsWith('calibration-label:'),
    );
    // One readable speed label per swatch, fastest to slowest (matching cell order).
    expect(labels.map((object) => object.source)).toEqual([
      'calibration-label:3000',
      'calibration-label:2000',
      'calibration-label:1000',
    ]);
    // Each label sits just below its swatch and within the swatch's horizontal span.
    pattern.cells.forEach((cell, index) => {
      const label = labels[index]!;
      expect(label.transform.y).toBeGreaterThan(cell.bounds.maxY);
      expect(label.transform.x).toBeGreaterThanOrEqual(cell.bounds.minX);
    });
    // Labels live on their own dedicated calibration-label layer.
    expect(
      pattern.scene.layers.some((layer) => layer.id === 'scan-offset-calibration-labels'),
    ).toBe(true);
  });
});
