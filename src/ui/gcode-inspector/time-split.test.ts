import { describe, expect, it } from 'vitest';
import { buildProgramTime, type MotionLimits } from '../../core/gcode-time';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import { timeSplit } from './time-split';

const LIMITS: MotionLimits = {
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6000,
};

function built(text: string): {
  readonly model: GcodeRenderModel;
  readonly time: ReturnType<typeof buildProgramTime>;
} {
  const parsed = buildGcodeRenderModel(text);
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  return { model: parsed.model, time: buildProgramTime(parsed.model, LIMITS) };
}

const PROGRAM = ['G21 G90', 'M3 S600', 'G0 X10 Y10', 'G1 Z-2 F150', 'G1 X90 F600', 'G0 Z5'].join(
  '\n',
);

describe('timeSplit', () => {
  it('shares out the whole of motion time', () => {
    const { model, time } = built(PROGRAM);
    const shares = timeSplit(model, time);
    expect(shares.length).toBeGreaterThan(0);
    const seconds = shares.reduce((total, share) => total + share.seconds, 0);
    expect(seconds).toBeCloseTo(time.motionSeconds, 4);
    const percent = shares.reduce((total, share) => total + share.percent, 0);
    expect(percent).toBeCloseTo(100, 3);
  });

  it('ranks the slowest kind first, and names it', () => {
    const { model, time } = built(PROGRAM);
    const shares = timeSplit(model, time);
    // 80 mm of cutting at 600 mm/min dominates everything else here.
    expect(shares[0]?.label).toBe('Cutting');
    for (let index = 1; index < shares.length; index += 1) {
      expect(shares[index - 1]?.seconds).toBeGreaterThanOrEqual(shares[index]?.seconds ?? 0);
    }
  });

  it('omits kinds the program never uses', () => {
    const { model, time } = built(['G21 G90', 'M3 S1', 'G1 X50 F600'].join('\n'));
    expect(timeSplit(model, time).map((share) => share.label)).toEqual(['Cutting']);
  });

  it('is empty when nothing moves', () => {
    const { model, time } = built(['G21 G90', 'M3 S0', 'M5'].join('\n'));
    expect(timeSplit(model, time)).toEqual([]);
  });
});
