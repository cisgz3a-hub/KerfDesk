import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { buildProgramTimeline } from '../gcode-time';
import { deviceProgramTimingOptions } from '../gcode-time/program-timing-options';
import { controllerArcPoints, GRBL_DEFAULT_ARC_TOLERANCE_MM } from './controller-arc-points';

describe('controllerArcPoints (ADR-407)', () => {
  it('splits an arc into as many chords as mc_arc does', () => {
    const radius = 10;
    const sweep = Math.PI / 2;
    const tolerance = GRBL_DEFAULT_ARC_TOLERANCE_MM;
    const segments = Math.floor(
      (0.5 * sweep * radius) / Math.sqrt(tolerance * (2 * radius - tolerance)),
    );
    const points = controllerArcPoints({ x: 0, y: 0 }, radius, 0, sweep, tolerance);
    expect(points).toHaveLength(segments + 1);
    expect(segments).toBe(39);
    const [a, b] = points;
    if (a === undefined || b === undefined) throw new Error('expected points');
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    // mc_arc rounds the count down, so a chord can sag a little past $12.
    expect(radius - Math.hypot(midX, midY)).toBeLessThan(tolerance * 1.05);
  });

  it('keeps an arc too small to split as one chord', () => {
    expect(controllerArcPoints({ x: 0, y: 0 }, 0.05, 0, 0.1, 0.002)).toHaveLength(2);
  });

  it('times GRBL laser arcs through the controller interpolation', () => {
    const options = deviceProgramTimingOptions(DEFAULT_DEVICE_PROFILE, 'laser');
    expect(options.controllerArcToleranceMm).toBe(GRBL_DEFAULT_ARC_TOLERANCE_MM);
    expect(deviceProgramTimingOptions(DEFAULT_DEVICE_PROFILE, 'cnc').controllerArcToleranceMm).toBe(
      undefined,
    );
    const program = ['G21', 'G90', 'M4 S0', 'G0 X10 Y0 S0', 'G3 X0 Y10 I-10 J0 F3000 S500', 'M5'];
    const limits = { accelMmPerSec2: 500, junctionDeviationMm: 0.01, maxFeedMmPerMin: 6000 };
    const timed = buildProgramTimeline(program.join('\n'), limits, options);
    if (timed.kind !== 'ok') throw new Error('expected a timeline');
    expect(timed.timeline.totalRouteMm).toBeCloseTo(10 + (Math.PI * 10) / 2, 3);
    expect(timed.timeline.segmentDistanceMm.length).toBeGreaterThanOrEqual(1 + 39);
  });
});
