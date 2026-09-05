import { describe, expect, it } from 'vitest';
import { offsetForSpeed } from '../job';
import {
  scanOffsetMeasurementFromLaserForge,
  scanOffsetMeasurementToLaserForge,
  scanOffsetSpeedFromMmPerMin,
  scanOffsetSpeedToMmPerMin,
} from './scan-offset-measurement-format';

describe('scan-offset measurement format conversion', () => {
  it('keeps native full-separation values and mm/min speeds byte-for-byte compatible', () => {
    expect(scanOffsetSpeedToMmPerMin(6000, 'mm-per-minute')).toBe(6000);
    expect(scanOffsetMeasurementToLaserForge(-0.24, 'laserforge-full-reverse-only')).toBe(-0.24);
  });

  it('converts LightBurn mm/s and half-pair shifts to LaserForge storage', () => {
    expect(scanOffsetSpeedToMmPerMin(100, 'mm-per-second')).toBe(6000);
    expect(scanOffsetMeasurementToLaserForge(0.12, 'lightburn-half-both-directions')).toBe(0.24);
    expect(scanOffsetMeasurementToLaserForge(-0.12, 'lightburn-half-both-directions')).toBe(-0.24);
  });

  it('round-trips persisted values through either display format', () => {
    const storedSpeed = 4500;
    const storedOffset = -0.18;
    const shownSpeed = scanOffsetSpeedFromMmPerMin(storedSpeed, 'mm-per-second');
    const shownOffset = scanOffsetMeasurementFromLaserForge(
      storedOffset,
      'lightburn-half-both-directions',
    );

    expect(scanOffsetSpeedToMmPerMin(shownSpeed, 'mm-per-second')).toBe(storedSpeed);
    expect(scanOffsetMeasurementToLaserForge(shownOffset, 'lightburn-half-both-directions')).toBe(
      storedOffset,
    );
  });

  it('preserves converted table interpolation in LaserForge units', () => {
    const table = [
      {
        speedMmPerMin: scanOffsetSpeedToMmPerMin(50, 'mm-per-second'),
        offsetMm: scanOffsetMeasurementToLaserForge(0.06, 'lightburn-half-both-directions'),
      },
      {
        speedMmPerMin: scanOffsetSpeedToMmPerMin(100, 'mm-per-second'),
        offsetMm: scanOffsetMeasurementToLaserForge(0.12, 'lightburn-half-both-directions'),
      },
    ];

    expect(offsetForSpeed(table, 4500)).toBeCloseTo(0.18, 12);
  });
});
