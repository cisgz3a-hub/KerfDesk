import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { describePatch, describeReviewItems } from './DetectedSettingsBanner';

describe('describePatch', () => {
  it('surfaces GRBL $31 and $32 alongside $30 detected settings', () => {
    const rows = describePatch(
      { maxPowerS: 255, minPowerS: 10, laserModeEnabled: false },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(rows.map((r) => r.label)).toEqual([
      'Max power (S)',
      'Min power (S)',
      'Laser mode ($32)',
    ]);
    expect(rows[1]).toMatchObject({
      oldText: '0',
      newText: '10',
      changed: true,
    });
    expect(rows[2]).toMatchObject({
      oldText: 'Enabled',
      newText: 'Disabled',
      changed: true,
    });
  });

  it('surfaces detected Z max travel from GRBL $132', () => {
    const rows = describePatch({ zTravelMm: 75 }, DEFAULT_DEVICE_PROFILE);

    expect(rows).toEqual([
      expect.objectContaining({
        label: 'Z travel',
        oldText: 'Not set',
        newText: '75.000 mm',
        changed: true,
      }),
    ]);
  });
});

describe('describeReviewItems', () => {
  it('flags powered Z as a review-only suggestion instead of an auto-applied capability', () => {
    const review = describeReviewItems(
      { zTravelMm: 75 },
      DEFAULT_DEVICE_PROFILE,
      { zTravelMm: 75, zMaxFeed: 300 },
      [],
    );

    expect(review.needsReview).toEqual([
      expect.objectContaining({
        label: 'Powered Z jog',
        detail:
          'Controller reports Z travel and Z max rate. Confirm the machine has a motorized Z/focus axis before enabling Z jog buttons.',
      }),
    ]);
    expect(review.ignored).toEqual([]);
  });

  it('surfaces homing and limit settings as review-only controller behavior', () => {
    const review = describeReviewItems(
      {},
      DEFAULT_DEVICE_PROFILE,
      {
        softLimitsEnabled: true,
        hardLimitsEnabled: false,
        homingEnabled: true,
        homingDirectionMask: 3,
      },
      [],
    );

    expect(review.needsReview.map((item) => item.label)).toEqual([
      'Soft limits ($20)',
      'Hard limits ($21)',
      'Homing cycle ($22)',
      'Homing direction mask ($23)',
    ]);
  });

  it('lists unknown GRBL settings as ignored so auto-detect stays explainable', () => {
    const review = describeReviewItems({}, DEFAULT_DEVICE_PROFILE, {}, [
      {
        id: 999,
        code: '$999',
        rawValue: '42',
        numericValue: 42,
        name: 'Unknown GRBL setting',
        unit: null,
        description: 'Unknown',
        category: 'unknown',
        known: false,
        writeRisk: 'unknown',
      },
    ]);

    expect(review.ignored).toEqual([
      expect.objectContaining({
        label: '$999',
        detail: 'Unknown GRBL setting was read but not applied to the LaserForge profile.',
      }),
    ]);
  });
});
