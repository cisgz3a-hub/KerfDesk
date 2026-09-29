// Oracles, pinned firmware sources:
// - GRBL 1.1h checks a jog target against [-$130, 0] per axis, or [0, $130]
//   for a negative-homing axis built with HOMING_FORCE_SET_ORIGIN (OPT:Z)
//   (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L334-L352);
//   without OPT:Z homing trips the switch at 0 (positive homing) or at -$130
//   (negative homing) and rests $27 inside (grbl/limits.c#L366-L384).
// - grblHAL's envelope for a homed axis with hard limits on is
//   [-$130 + $27, -$27], or with force origin [-$130 + $27, 0] / [0, $130 - $27]
//   (https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/machine_limits.c#L114-L136).
// - Both add a jog's distance to the parser position, which after a move that
//   ran to its end is that move's unrounded target, while the status report
//   shows the reached step rounded to 3 decimals
//   (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L863-L864).

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
  stepsPerMm: { x: 250, y: 250 },
};
const GRBLHAL: JogTravelSettings = { ...GRBL, firmware: 'grblhal', forceOrigin: null };

function box(minX: number, maxX: number, minY: number, maxY: number) {
  return { x: { minMm: minX, maxMm: maxX }, y: { minMm: minY, maxMm: maxY } };
}

// Where the firmware aims a jog KerfDesk sent to reach `aimedAt`: the
// distance is measured from the reported MPos and added to the firmware's own
// position.
function firmwareTarget(firmwarePosition: number, reported: number, aimedAt: number): number {
  return firmwarePosition + (aimedAt - reported);
}

describe('jogTravelLimits on stock GRBL', () => {
  it('stops the pull-off short of a positive-homing switch and a margin inside both edges', () => {
    expect(jogTravelLimits(GRBL)).toEqual(box(-399.99, -2.01, -299.99, -2.01));
  });

  it('puts the pull-off on the minimum edge for negative-homing axes ($23=3)', () => {
    expect(jogTravelLimits({ ...GRBL, homingDirectionMask: 3 })).toEqual(
      box(-397.99, -0.01, -297.99, -0.01),
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
      box(-399.99, -1.01, -299.99, -1.01),
    );
    expect(jogTravelLimits({ ...GRBL, hardLimits: undefined, pullOffMm: 3 })).toEqual(
      box(-399.99, -3.01, -299.99, -3.01),
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
    expect(jogTravelLimits({ ...GRBL, forceOrigin: null })).toEqual(
      box(-399.99, -2.01, -299.99, -2.01),
    );
    expect(jogTravelLimits({ ...GRBL, forceOrigin: null, homingDirectionMask: 1 })).toBeNull();
    expect(jogTravelLimits({ ...GRBL, forceOrigin: null, homingDirectionMask: 2 })).toBeNull();
  });
});

describe('jogTravelLimits on grblHAL', () => {
  // grblHAL's own envelope is already pulled in by the pull-off, so a box on it
  // exactly let report rounding carry a hold past it (ADR-375 re-audit).
  it('keeps the margin inside the firmware envelope pulled in on both edges', () => {
    expect(jogTravelLimits(GRBLHAL)).toEqual(box(-397.99, -2.01, -297.99, -2.01));
  });

  it('keeps a hold aimed at the edge inside that envelope when the report rounds', () => {
    // $130=400, $27=1: grblHAL accepts X in [-399, -1]; the head is at
    // -123.4567 and reported as -123.457.
    const limits = jogTravelLimits({ ...GRBLHAL, pullOffMm: 1 });
    expect(limits).not.toBeNull();
    expect(firmwareTarget(-123.4567, -123.457, limits?.x.maxMm ?? 0)).toBeLessThanOrEqual(-1);
    expect(firmwareTarget(-123.4563, -123.456, limits?.x.minMm ?? 0)).toBeGreaterThanOrEqual(-399);
  });

  it('keeps the rounding margin with hard limits off', () => {
    expect(jogTravelLimits({ ...GRBLHAL, hardLimits: false })).toEqual(
      box(-399.99, -0.01, -299.99, -0.01),
    );
  });

  it('insets the far edge only when force origin is known', () => {
    expect(jogTravelLimits({ ...GRBLHAL, forceOrigin: true, homingDirectionMask: 3 })).toEqual(
      box(0.01, 397.99, 0.01, 297.99),
    );
    expect(jogTravelLimits({ ...GRBLHAL, homingDirectionMask: 3 })).toBeNull();
  });

  it('ignores homing bits of axes beyond X and Y', () => {
    expect(jogTravelLimits({ ...GRBLHAL, homingDirectionMask: 12 })).toEqual(
      jogTravelLimits(GRBLHAL),
    );
  });
});

describe('jogTravelLimits margin and step size', () => {
  // With $100=40 a move to X-379.987 ends on the step at -379.975 while GRBL
  // keeps -379.987, so the margin must cover half a step as well as rounding.
  it('keeps half a coarse step of room at the edge', () => {
    const limits = jogTravelLimits({ ...GRBL, stepsPerMm: { x: 40, y: 40 } });
    expect(limits?.x.minMm).toBeCloseTo(-399.9855, 9);
    expect(firmwareTarget(-379.987, -379.975, limits?.x.minMm ?? 0)).toBeGreaterThanOrEqual(-400);
  });

  it('keeps 0.01 mm on fine axes and a wider margin when the step size is unread', () => {
    expect(jogTravelLimits({ ...GRBL, stepsPerMm: { x: 800, y: 800 } })).toEqual(
      jogTravelLimits(GRBL),
    );
    const limits = jogTravelLimits({ ...GRBL, stepsPerMm: { x: undefined, y: 250 } });
    expect(limits?.x.minMm).toBeCloseTo(-399.95, 9);
    expect(limits?.x.maxMm).toBeCloseTo(-2.05, 9);
    expect(limits?.y).toEqual({ minMm: -299.99, maxMm: -2.01 });
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
