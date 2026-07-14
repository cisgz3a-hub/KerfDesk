import { describe, expect, it } from 'vitest';
import {
  buildGrblFrameJogLines,
  buildGrblFrameRetract,
} from '../../core/controllers/grbl/frame-lines';
import { buildCncFrameMotion } from './cnc-frame-lines';

const PERIMETER = buildGrblFrameJogLines({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, 1000);
const SAFE_Z = 3.81;
const FEED = 1000;

function motion(overrides: {
  readonly preFrameWorkZMm: number | null;
  readonly hasCurrentWorkZEvidence: boolean;
  readonly buildRetract?: ((zMm: number, feed: number) => string) | undefined;
}): ReadonlyArray<string> {
  return buildCncFrameMotion({
    perimeter: PERIMETER,
    safeZMm: SAFE_Z,
    feed: FEED,
    buildRetract: 'buildRetract' in overrides ? overrides.buildRetract : buildGrblFrameRetract,
    ...overrides,
  });
}

describe('buildCncFrameMotion', () => {
  // The BUG-2 fix: after framing the bit returns to the pre-frame Z instead of
  // being left parked at safe height.
  it('wraps the perimeter with a safe-Z retract and a restore to the pre-frame Z', () => {
    const lines = motion({ preFrameWorkZMm: 0, hasCurrentWorkZEvidence: true });
    expect(lines[0]).toBe('$J=G90 G21 Z3.810 F1000\n'); // retract up to safe Z
    expect(lines.slice(1, 1 + PERIMETER.length)).toEqual(PERIMETER);
    expect(lines[lines.length - 1]).toBe('$J=G90 G21 Z0.000 F1000\n'); // restore to Z0
    expect(lines).toHaveLength(PERIMETER.length + 2);
  });

  it('restores to a parked height above the stock (post-probe park)', () => {
    const lines = motion({ preFrameWorkZMm: 20, hasCurrentWorkZEvidence: true });
    expect(lines[lines.length - 1]).toBe('$J=G90 G21 Z20.000 F1000\n');
  });

  // Without a known Z0 the work-frame retract targets an arbitrary physical
  // height, so the frame degrades to XY-only rather than risk a blind Z move.
  it('emits an XY-only perimeter when there is no current work-Z evidence', () => {
    expect(motion({ preFrameWorkZMm: 0, hasCurrentWorkZEvidence: false })).toEqual(PERIMETER);
  });

  it('emits an XY-only perimeter when the driver has no Z-jog builder', () => {
    expect(
      motion({ preFrameWorkZMm: 0, hasCurrentWorkZEvidence: true, buildRetract: undefined }),
    ).toEqual(PERIMETER);
  });

  // Unknown pre-frame Z: retract but do not guess a restore target — leave the
  // bit at safe Z rather than jog somewhere unverified.
  it('retracts without a restore when the pre-frame Z is unknown', () => {
    const lines = motion({ preFrameWorkZMm: null, hasCurrentWorkZEvidence: true });
    expect(lines).toEqual(['$J=G90 G21 Z3.810 F1000\n', ...PERIMETER]);
  });

  it('omits a redundant restore when the bit is already at safe Z', () => {
    const lines = motion({ preFrameWorkZMm: SAFE_Z, hasCurrentWorkZEvidence: true });
    expect(lines).toHaveLength(PERIMETER.length + 1);
    expect(lines[0]).toBe('$J=G90 G21 Z3.810 F1000\n');
  });
});
