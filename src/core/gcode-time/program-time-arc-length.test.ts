import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel } from '../gcode-view';
import { buildProgramTime } from './program-time';
import { segmentBlocks } from './segment-blocks';
import { buildProgramTimeline } from './program-timeline';
import { plannedProgressAtRoute } from './gcode-timing-plan';

const LIMITS = {
  accelMmPerSec2: 1000,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6000,
};

describe('true arc length in program timing', () => {
  it.each([1, 0.1])(
    'retains an R%s circle after a long route despite display-route rounding',
    (radius) => {
      // The controller program is never sent. The long out-and-back prefix makes
      // the cumulative Float32 display route coarser than the following chords.
      const gcode = `G0 X8388608\nG0 X${radius}\nM400\nG3 X${radius} Y0 I-${radius} J0 F60`;
      const result = buildProgramTimeline(gcode, LIMITS);
      if (result.kind !== 'ok') throw new Error(result.reason);
      const plan = result.timeline;
      let arcDistance = 0;
      let arcSeconds = 0;
      for (let index = 0; index < plan.segmentRawLine.length; index += 1) {
        if (plan.segmentRawLine[index] !== 3) continue;
        arcDistance += plan.segmentDistanceMm[index] ?? 0;
        arcSeconds +=
          (plan.plannedMotionEndSeconds[index] ?? 0) - (plan.plannedMotionStartSeconds[index] ?? 0);
      }
      expect(arcDistance).toBeCloseTo(2 * Math.PI * radius, 6);
      for (let index = 2; index < plan.routeEndMm.length; index += 1) {
        expect(plan.routeEndMm[index]).toBeGreaterThan(plan.routeStartMm[index] ?? 0);
      }
      // At F60, true distance in millimetres equals cruise seconds. M400 gives
      // a rest-to-rest arc, whose two ramps together add v/a = 0.001 seconds.
      expect(arcSeconds).toBeCloseTo(2 * Math.PI * radius + 0.001, 6);
    },
  );

  it('keeps small later motion addressable on the execution route', () => {
    const result = buildProgramTimeline('G0 X20000\nG0 X0\nM400\nG1 X0.001 F60', LIMITS);
    if (result.kind !== 'ok') throw new Error(result.reason);
    const plan = result.timeline;
    const start = plan.plannedMotionStartSeconds[2] ?? 0;
    const end = plan.plannedMotionEndSeconds[2] ?? 0;
    const halfway = plannedProgressAtRoute(plan, 40000.0005).motionSeconds;
    expect(plan.routeEndMm[2]).toBeCloseTo(40000.001, 8);
    expect(halfway).toBeGreaterThan(start);
    expect(halfway).toBeLessThan(end);
  });

  it('keeps precise-length storage optional for rendering-only models', () => {
    const display = buildGcodeRenderModel('G1 X1 F60');
    const timing = buildGcodeRenderModel('G1 X1 F60', { retainPreciseSegmentLengths: true });
    if (display.kind !== 'ok' || timing.kind !== 'ok') throw new Error('Expected parsed moves');
    expect(display.model.segLengthMm).toBeUndefined();
    expect(timing.model.segLengthMm).toEqual(new Float64Array([1]));
  });

  it.each([0, -5])('prices a full circle ending at Z%s using its true 3D length', (z) => {
    const parsed = buildGcodeRenderModel(`G21 G90\nG3 X1 Y0 Z${z} I-1 J0 F60`, {
      initialPositionMm: { x: 1, y: 0, z: 0 },
    });
    if (parsed.kind !== 'ok') throw new Error(parsed.reason);
    const blocks = segmentBlocks(parsed.model, LIMITS);
    const trueLength = Math.hypot(2 * Math.PI, z);
    const totalDistance = blocks.reduce((total, block) => total + block.distance, 0);

    // The render route is Float32, but its final length is arc-true. Summing
    // the visual XYZ chords loses more than 0.01 mm on this unit circle.
    expect(totalDistance).toBeCloseTo(trueLength, 6);
    for (const block of blocks) {
      expect(Math.hypot(block.direction.x, block.direction.y, block.direction.z ?? 0)).toBeCloseTo(
        1,
        12,
      );
    }
    // F60 gives 1 mm/s. The circle's sampled turns do not limit this low
    // feed, so a rest-to-rest trapezoid adds v/a = 0.001 seconds.
    const time = buildProgramTime(parsed.model, LIMITS);
    expect(time.motionSeconds).toBeCloseTo(trueLength + 0.001, 6);
  });
});
