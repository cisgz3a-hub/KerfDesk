import { describe, expect, it } from 'vitest';
import { buildProgramTime } from '../../core/gcode-time';
import { buildGcodeRenderModel, SEG_KIND } from '../../core/gcode-view';
import { inspectorProgramTime, inspectorRenderModel } from './inspector-model';

const LIMITS = { accelMmPerSec2: 500, junctionDeviationMm: 0.01, maxFeedMmPerMin: 6000 };

function parsed(text: string) {
  const result = buildGcodeRenderModel(text, { retainPreciseSegmentLengths: true });
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

describe('Inspector model (ADR-485)', () => {
  it('keeps every array the Inspector reads, shared rather than copied', () => {
    const model = parsed('G21 G90\nG0 X5\nG1 Z-1 F300\nG1 X20 F900\nG0 Z5');
    const kept = inspectorRenderModel(model);
    expect(kept.positions).toBe(model.positions);
    expect(kept.segLine).toBe(model.segLine);
    expect(kept.segmentCount).toBe(model.segmentCount);
    expect(kept).not.toHaveProperty('segRouteEndMm');
    expect(kept).not.toHaveProperty('segLengthMm');
  });

  it('sums each move kind into the seconds the time split reports', () => {
    const model = parsed('G21 G90\nG0 X5\nG1 Z-1 F300\nG1 X20 F900\nG0 Z5');
    const full = buildProgramTime(model, LIMITS);
    const time = inspectorProgramTime(model, full);
    const expected = [0, 0, 0, 0];
    for (let index = 0; index < model.segmentCount; index += 1) {
      const kind = model.segKind[index] ?? SEG_KIND.travel;
      expected[kind] = (expected[kind] ?? 0) + (full.segSeconds[index] ?? 0);
    }
    expect(Array.from(time.kindSeconds)).toEqual(expected);
    expect(time.kindSeconds.reduce((sum, seconds) => sum + seconds, 0)).toBeCloseTo(
      full.motionSeconds,
      9,
    );
    expect(time.segTimeEndSec).toBe(full.segTimeEndSec);
    expect(time).not.toHaveProperty('segSeconds');
  });
});
