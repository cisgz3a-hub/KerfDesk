import { describe, expect, it } from 'vitest';
import { assessCalibrationTrust, type TrustInput } from './calibration-trust';
import type { QuadrantCoverage } from './calibrate-metrics';

const EVEN_COVERAGE: QuadrantCoverage[] = [
  { quadrant: 'tl', corners: 40 },
  { quadrant: 'tr', corners: 46 },
  { quadrant: 'bl', corners: 50 },
  { quadrant: 'br', corners: 39 },
];

const GOOD: TrustInput = {
  intrinsics: { fx: 900, fy: 890, cx: 955, cy: 545 },
  distortion: [0.08, -0.01, 0.004, -0.0005],
  imageWidth: 1920,
  imageHeight: 1080,
  rmsPx: 0.32,
  coverage: EVEN_COVERAGE,
};

describe('assessCalibrationTrust', () => {
  it('trusts a plausible calibration', () => {
    expect(assessCalibrationTrust(GOOD)).toEqual({ kind: 'trusted' });
  });

  it('flags a degenerate intrinsics that a low RMS would otherwise pass', () => {
    expect(
      assessCalibrationTrust({ ...GOOD, intrinsics: { ...GOOD.intrinsics, fx: -10 } }).kind,
    ).toBe('suspect');
    const offCentre = assessCalibrationTrust({
      ...GOOD,
      intrinsics: { ...GOOD.intrinsics, cx: 9000 }, // far outside a 1920-wide frame
    });
    expect(offCentre.kind).toBe('suspect');
    if (offCentre.kind !== 'suspect') return;
    expect(offCentre.reasons.some((r) => r.kind === 'intrinsics-implausible')).toBe(true);
  });

  it('flags the noise-overfit case (huge k3, but a low RMS that would otherwise pass)', () => {
    // The exact failure mode from the v2.c finding: RMS stays ~0.15px while k3 blows up.
    const verdict = assessCalibrationTrust({
      ...GOOD,
      distortion: [0.021, -0.026, 205.17, -6180.04],
      rmsPx: 0.149,
    });
    expect(verdict.kind).toBe('suspect');
    if (verdict.kind !== 'suspect') return;
    const flagged = verdict.reasons
      .filter((r) => r.kind === 'coefficient-out-of-bounds')
      .map((r) => (r.kind === 'coefficient-out-of-bounds' ? r.coefficient : ''));
    expect(flagged).toContain('k3');
    expect(flagged).toContain('k4');
  });

  it('flags a poor fit by RMS', () => {
    const verdict = assessCalibrationTrust({ ...GOOD, rmsPx: 3.2 });
    expect(verdict.kind).toBe('suspect');
    if (verdict.kind !== 'suspect') return;
    expect(verdict.reasons.some((r) => r.kind === 'rms-too-high')).toBe(true);
  });

  it('flags an empty or lopsided quadrant', () => {
    const verdict = assessCalibrationTrust({
      ...GOOD,
      coverage: [
        { quadrant: 'tl', corners: 60 },
        { quadrant: 'tr', corners: 58 },
        { quadrant: 'bl', corners: 55 },
        { quadrant: 'br', corners: 1 },
      ],
    });
    expect(verdict.kind).toBe('suspect');
    if (verdict.kind !== 'suspect') return;
    expect(verdict.reasons.some((r) => r.kind === 'uneven-coverage')).toBe(true);
  });

  it('collects multiple independent reasons at once', () => {
    const verdict = assessCalibrationTrust({ ...GOOD, distortion: [5, 0, 0, 0], rmsPx: 9 });
    expect(verdict.kind).toBe('suspect');
    if (verdict.kind !== 'suspect') return;
    expect(verdict.reasons.length).toBeGreaterThanOrEqual(2);
  });
});
