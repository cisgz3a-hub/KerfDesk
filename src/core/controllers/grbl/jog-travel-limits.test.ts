// Oracles, pinned firmware sources:
// - GRBL 1.1h checks a jog target against [-$130, 0] per axis, or [0, $130]
//   for a negative-homing axis built with HOMING_FORCE_SET_ORIGIN (OPT:Z)
//   (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L334-L352);
//   without OPT:Z homing trips the switch at 0 (positive homing) or at -$130
//   (negative homing) and rests $27 inside (grbl/limits.c#L366-L384).
// - grblHAL's envelope for a homed axis with hard limits on is
//   [-$130 + $27, -$27], or with force origin [-$130 + $27, 0] / [0, $130 - $27]
//   (https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/machine_limits.c#L114-L136).

import { describe, expect, it } from 'vitest';
import { jogTravelLimits, type JogTravelSettings } from './jog-travel-limits';

const GRBL: JogTravelSettings = {
  firmware: 'grbl',
  travelMm: { x: 400, y: 300 },
  homingDirectionMask: 0,
  forceOrigin: false,
  hardLimits: true,
  pullOffMm: 2,
  softLimitsEnforced: true,
};
const GRBLHAL: JogTravelSettings = { ...GRBL, firmware: 'grblhal', forceOrigin: null };

function box(minX: number, maxX: number, minY: number, maxY: number) {
  return { x: { minMm: minX, maxMm: maxX }, y: { minMm: minY, maxMm: maxY } };
}

describe('jogTravelLimits on stock GRBL', () => {
  it('stops the pull-off short of a positive-homing switch and a margin inside the far edge', () => {
    expect(jogTravelLimits(GRBL)).toEqual(box(-399.99, -2, -299.99, -2));
  });

  it('puts the pull-off on the minimum edge for negative-homing axes ($23=3)', () => {
    expect(jogTravelLimits({ ...GRBL, homingDirectionMask: 3 })).toEqual(
      box(-398, -0.01, -298, -0.01),
    );
  });

  it('keeps only the rounding margin with hard limits off ($21=0)', () => {
    expect(jogTravelLimits({ ...GRBL, hardLimits: false })).toEqual(
      box(-399.99, -0.01, -299.99, -0.01),
    );
  });

  it('keeps the switch inset but no margin when soft limits are not enforced', () => {
    expect(jogTravelLimits({ ...GRBL, softLimitsEnforced: false })).toEqual(
      box(-400, -2, -300, -2),
    );
  });

  it('insets 1 mm when $27 is unread and keeps the inset when $21 is unread', () => {
    expect(jogTravelLimits({ ...GRBL, pullOffMm: undefined })).toEqual(
      box(-399.99, -1, -299.99, -1),
    );
    expect(jogTravelLimits({ ...GRBL, hardLimits: undefined, pullOffMm: 3 })).toEqual(
      box(-399.99, -3, -299.99, -3),
    );
  });

  it('uses the forced-origin envelope, whose homing edge is already clear of the switch', () => {
    expect(jogTravelLimits({ ...GRBL, forceOrigin: true, homingDirectionMask: 3 })).toEqual(
      box(0.01, 399.99, 0.01, 299.99),
    );
    expect(jogTravelLimits({ ...GRBL, forceOrigin: true, homingDirectionMask: 0 })).toEqual(
      box(-399.99, -0.01, -299.99, -0.01),
    );
  });

  it('knows a positive-homing axis without $I but not a negative-homing one', () => {
    expect(jogTravelLimits({ ...GRBL, forceOrigin: null })).toEqual(box(-399.99, -2, -299.99, -2));
    expect(jogTravelLimits({ ...GRBL, forceOrigin: null, homingDirectionMask: 1 })).toBeNull();
    expect(jogTravelLimits({ ...GRBL, forceOrigin: null, homingDirectionMask: 2 })).toBeNull();
  });
});

describe('jogTravelLimits on grblHAL', () => {
  it('matches the firmware envelope pulled in on both edges with hard limits on', () => {
    expect(jogTravelLimits(GRBLHAL)).toEqual(box(-398, -2, -298, -2));
  });

  it('keeps the rounding margin with hard limits off', () => {
    expect(jogTravelLimits({ ...GRBLHAL, hardLimits: false })).toEqual(
      box(-399.99, -0.01, -299.99, -0.01),
    );
  });

  it('insets the far edge only when force origin is known', () => {
    expect(jogTravelLimits({ ...GRBLHAL, forceOrigin: true, homingDirectionMask: 3 })).toEqual(
      box(0.01, 398, 0.01, 298),
    );
    expect(jogTravelLimits({ ...GRBLHAL, homingDirectionMask: 3 })).toBeNull();
  });

  it('ignores homing bits of axes beyond X and Y', () => {
    expect(jogTravelLimits({ ...GRBLHAL, homingDirectionMask: 12 })).toEqual(
      jogTravelLimits(GRBLHAL),
    );
  });
});

describe('jogTravelLimits without a usable envelope', () => {
  it.each<[string, Partial<JogTravelSettings>]>([
    ['zero travel', { travelMm: { x: 0, y: 300 } }],
    ['non-finite travel', { travelMm: { x: 400, y: Number.NaN } }],
    ['negative mask', { homingDirectionMask: -1 }],
    ['fractional mask', { homingDirectionMask: 1.5 }],
    ['pull-off wider than the travel', { firmware: 'grblhal', travelMm: { x: 3, y: 300 } }],
  ])('returns null for %s', (_name, patch) => {
    expect(jogTravelLimits({ ...GRBL, ...patch })).toBeNull();
  });
});
