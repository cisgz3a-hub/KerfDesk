import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel } from '../gcode-view';
import { buildProgramTime } from './program-time';
import { buildProgramTimeline } from './program-timeline';

const limits = { accelMmPerSec2: 500, junctionDeviationMm: 0.01, maxFeedMmPerMin: 6000 };
function time(source: string) {
  const parsed = buildGcodeRenderModel(source, { retainPreciseSegmentLengths: true });
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  return buildProgramTime(parsed.model, limits);
}

describe('G4 block execution order', () => {
  it('stops before the same-block motion and preserves blending into the next motion', () => {
    const combined = 'G1 X1 F6000\nG4 P2 G1 X101\nG1 X201';
    const separate = 'G1 X1 F6000\nG4 P2\nG1 X101\nG1 X201';
    expect(time(combined)).toEqual(time(separate));
    const result = buildProgramTimeline(combined, limits);
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.timeline.plannedStartSeconds[1]).toBeCloseTo(
      (result.timeline.plannedEndSeconds[0] ?? 0) + 2,
      9,
    );
  });

  it('preserves both before-motion dwell and after-motion pause on the same block', () => {
    const combined = 'G1 X1 F6000\nG4 P2 G1 X101 M0\nG1 X201';
    const separate = 'G1 X1 F6000\nG4 P2\nG1 X101\nM0\nG1 X201';
    expect(time(combined)).toEqual(time(separate));
  });
});
