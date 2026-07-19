import { describe, expect, it } from 'vitest';
import {
  buildGrblFrameJogLines,
  buildGrblFrameRetract,
} from '../../core/controllers/grbl/frame-lines';
import {
  CNC_FRAME_POSITION_REQUIRED_MESSAGE,
  CNC_FRAME_RETRACT_UNSUPPORTED_MESSAGE,
  CNC_FRAME_WORK_Z_REQUIRED_MESSAGE,
  buildCncFrameMotion,
  type CncFrameMotionPlan,
} from './cnc-frame-lines';

const PERIMETER = buildGrblFrameJogLines({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, 1000);
const SAFE_Z = 3.81;
const FEED = 1000;

function plan(overrides: {
  readonly preFrameWorkZMm: number | null;
  readonly hasCurrentWorkZEvidence: boolean;
  readonly buildRetract?: ((zMm: number, feed: number) => string) | undefined;
  readonly zFeed?: number;
}): CncFrameMotionPlan {
  return buildCncFrameMotion({
    perimeter: PERIMETER,
    safeZMm: SAFE_Z,
    zFeed: overrides.zFeed ?? FEED,
    buildRetract: 'buildRetract' in overrides ? overrides.buildRetract : buildGrblFrameRetract,
    ...overrides,
  });
}

function motion(overrides: Parameters<typeof plan>[0]): ReadonlyArray<string> {
  const result = plan(overrides);
  if (result.kind === 'blocked') throw new Error(result.message);
  return result.lines;
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

  it('uses the separate Z feed without changing the XY perimeter feed', () => {
    const lines = motion({
      preFrameWorkZMm: 0,
      hasCurrentWorkZEvidence: true,
      zFeed: 300,
    });
    expect(lines[0]).toBe('$J=G90 G21 Z3.810 F300\n');
    expect(lines.slice(1, 1 + PERIMETER.length)).toEqual(PERIMETER);
    expect(lines[lines.length - 1]).toBe('$J=G90 G21 Z0.000 F300\n');
  });

  it('leaves a bit that started below work Z0 at safe Z instead of plunging back into stock', () => {
    const lines = motion({ preFrameWorkZMm: -2, hasCurrentWorkZEvidence: true });
    expect(lines).toHaveLength(PERIMETER.length + 1);
    expect(lines[0]).toBe('$J=G90 G21 Z3.810 F1000\n');
    expect(lines[lines.length - 1]).toBe(PERIMETER[PERIMETER.length - 1]);
  });

  it('blocks when there is no current work-Z evidence', () => {
    expect(plan({ preFrameWorkZMm: 0, hasCurrentWorkZEvidence: false })).toEqual({
      kind: 'blocked',
      message: CNC_FRAME_WORK_Z_REQUIRED_MESSAGE,
    });
  });

  it('blocks when the driver has no Z-jog builder', () => {
    expect(
      plan({ preFrameWorkZMm: 0, hasCurrentWorkZEvidence: true, buildRetract: undefined }),
    ).toEqual({
      kind: 'blocked',
      message: CNC_FRAME_RETRACT_UNSUPPORTED_MESSAGE,
    });
  });

  it('blocks when the pre-frame work Z is unknown', () => {
    expect(plan({ preFrameWorkZMm: null, hasCurrentWorkZEvidence: true })).toEqual({
      kind: 'blocked',
      message: CNC_FRAME_POSITION_REQUIRED_MESSAGE,
    });
  });

  it('omits a redundant restore when the bit is already at safe Z', () => {
    const lines = motion({ preFrameWorkZMm: SAFE_Z, hasCurrentWorkZEvidence: true });
    expect(lines).toHaveLength(PERIMETER.length + 1);
    expect(lines[0]).toBe('$J=G90 G21 Z3.810 F1000\n');
  });
});
