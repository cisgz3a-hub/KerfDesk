import { describe, expect, it } from 'vitest';
import { buildProgramTimeline } from './program-timeline';

const LIMITS = {
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6000,
};

describe('buildProgramTimeline', () => {
  it('places every spindle dwell on its exact raw and sendable line', () => {
    const gcode = [
      '; spindle startup',
      'G21 G90',
      'M3 S12000',
      'G4 P3',
      '',
      'G1 X10 F600',
      'M5',
      'M3 S8000',
      'G4 P2',
      'G1 X20 F600',
    ].join('\n');
    const result = buildProgramTimeline(gcode, LIMITS);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const { timeline } = result;
    expect(timeline.dwellSeconds).toBe(5);
    expect((timeline.rawLineEndSeconds[3] ?? 0) - (timeline.rawLineStartSeconds[3] ?? 0)).toBe(3);
    expect((timeline.rawLineEndSeconds[8] ?? 0) - (timeline.rawLineStartSeconds[8] ?? 0)).toBe(2);
    expect(timeline.sendableLineEndSeconds).toHaveLength(8);
    expect(timeline.sendableLineEndSeconds[2]).toBe(timeline.rawLineEndSeconds[3]);
    expect(timeline.sendableLineEndSeconds[6]).toBe(timeline.rawLineEndSeconds[8]);
    expect(timeline.totalSeconds).toBeCloseTo(timeline.motionSeconds + timeline.dwellSeconds, 9);
  });

  it('returns Float64 cumulative clocks and route-addressable timed segments', () => {
    const result = buildProgramTimeline('G21 G90\nG4 P4\nG1 X60 F600', LIMITS);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const { timeline } = result;
    expect(timeline.rawLineStartSeconds).toBeInstanceOf(Float64Array);
    expect(timeline.rawLineEndSeconds).toBeInstanceOf(Float64Array);
    expect(timeline.sendableLineEndSeconds).toBeInstanceOf(Float64Array);
    expect(timeline.routeStartMm).toBeInstanceOf(Float64Array);
    expect(timeline.routeEndMm).toBeInstanceOf(Float64Array);
    expect(timeline.plannedStartSeconds).toBeInstanceOf(Float64Array);
    expect(timeline.plannedEndSeconds).toBeInstanceOf(Float64Array);
    expect(timeline.segmentRawLine[0]).toBe(2);
    expect(timeline.routeStartMm[0]).toBe(0);
    expect(timeline.routeEndMm[0]).toBeCloseTo(60, 6);
    expect(timeline.plannedStartSeconds[0]).toBe(4);
    expect(timeline.plannedEndSeconds[0]).toBeGreaterThan(10);
  });

  it('uses the supplied controller position before the first emitted line', () => {
    const result = buildProgramTimeline('G21 G90\nG0 X100', LIMITS, {
      initialPositionMm: { x: 100, y: 0, z: 0 },
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.timeline.totalRouteMm).toBe(0);
    expect(result.timeline.totalSeconds).toBe(0);
  });

  it('times modal-inch rapid and feed Z moves like their millimetre equivalents', () => {
    const inch = buildProgramTimeline('G20 G90\nG0 Z1\nG1 Z0 F60', LIMITS);
    const millimetre = buildProgramTimeline('G21 G90\nG0 Z25.4\nG1 Z0 F1524', LIMITS);

    expect(inch.kind).toBe('ok');
    expect(millimetre.kind).toBe('ok');
    if (inch.kind !== 'ok' || millimetre.kind !== 'ok') return;
    expect(inch.timeline.totalRouteMm).toBeCloseTo(50.8, 5);
    expect(inch.timeline.motionSeconds).toBeCloseTo(millimetre.timeline.motionSeconds, 5);
    expect(inch.timeline.segmentRawLine).toEqual(new Uint32Array([1, 2]));
  });

  it('exposes an indefinite pause without inventing elapsed seconds', () => {
    const result = buildProgramTimeline('G21 G90\nG1 X10 F600\nM0\nG1 X20 F600', LIMITS);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.timeline.pauseBarriers).toEqual([
      { rawLineIndex: 2, sendableLineIndex: 2, optional: false },
    ]);
    expect(result.timeline.rawLineStartSeconds[2]).toBe(result.timeline.rawLineEndSeconds[2]);
  });

  it('does not invent a feed rate from machine limits when emitted F state is unknown', () => {
    const result = buildProgramTimeline('G21 G90\nG1 X100', LIMITS);

    expect(result).toEqual({
      kind: 'unavailable',
      reason: 'Feed rate unavailable for feed motion at raw line 2.',
    });
  });

  it('returns unavailable before allocating sidecar clocks beyond the segment budget', () => {
    const result = buildProgramTimeline('G1 X1 F600\nG1 X2', LIMITS, {
      maxSegments: 1,
    });

    expect(result).toEqual({
      kind: 'unavailable',
      reason: 'Exact emitted program exceeds the live countdown segment budget.',
    });
  });

  it.each([
    ['G21 G90\nG1 X10 F600\nG93', 'unsupported'],
    ['G21 G90\nG2 X10 Y0', 'skipped motion'],
    ['G21 G90\nG82 X10 Z-1 R1 P2 F100', 'timing-unknown'],
  ])('returns unavailable for timing-unknown programs', (gcode, reason) => {
    const result = buildProgramTimeline(gcode, LIMITS);

    expect(result.kind).toBe('unavailable');
    if (result.kind !== 'unavailable') return;
    expect(result.reason.toLowerCase()).toContain(reason);
  });
});
