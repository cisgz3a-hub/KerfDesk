import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type ControllerKind } from '../devices';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../gcode-view';
import type { MotionLimits } from './motion-limits';
import { buildProgramTime } from './program-time';
import { buildProgramTimeline } from './program-timeline';
import { deviceProgramTimingOptions } from './program-timing-options';

const LIMITS: MotionLimits = {
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6000,
};

// One 40 mm raster row of 0.1 mm pixels at 6000 mm/min (100 mm/s).
const RASTER_ROW = [
  'G21 G90',
  ...Array.from({ length: 400 }, (_, pixel) => `G1 X${((pixel + 1) / 10).toFixed(1)} F6000`),
].join('\n');

function model(text: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(text, { retainPreciseSegmentLengths: true });
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

// A straight move that accelerates to `cruise`, holds it and stops again.
function trapezoidSeconds(lengthMm: number, cruise: number, accel: number): number {
  return (2 * cruise) / accel + (lengthMm - (cruise * cruise) / accel) / cruise;
}

// GRBL 1.1 sees 14 pixels (1.4 mm) past the one executing and must be able to
// stop within them, so every pixel boundary is crossed at sqrt(2 a 1.4 mm).
// The head reaches that speed over the first 14 pixels, speeds up and back
// down inside each of the next 372, and stops over the last 14.
function fifteenBlockRowSeconds(accel: number): number {
  const boundary = Math.sqrt(2 * accel * 1.4);
  const peak = Math.sqrt(boundary * boundary + accel * 0.1);
  return (2 * boundary) / accel + (372 * 2 * (peak - boundary)) / accel;
}

describe('program time with a finite planner (ADR-525)', () => {
  it('times a fine raster row at the speed a 15-block GRBL planner allows', () => {
    const windowed = buildProgramTime(model(RASTER_ROW), LIMITS, { plannerBlocks: 15 });
    expect(windowed.motionSeconds).toBeCloseTo(fifteenBlockRowSeconds(500), 6);
  });

  it('keeps unlimited lookahead when no planner size is given', () => {
    const unlimited = buildProgramTime(model(RASTER_ROW), LIMITS);
    expect(unlimited.motionSeconds).toBeCloseTo(trapezoidSeconds(40, 100, 500), 6);
  });

  it.each<[ControllerKind | undefined, number | undefined]>([
    [undefined, 15],
    ['grbl-v1.1', 15],
    ['grblhal', 100],
    ['fluidnc', 15],
    ['smoothieware', 32],
    ['marlin', 15],
    ['ruida', undefined],
  ])('gives a %s device its planner size: %s blocks', (controllerKind, blocks) => {
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      ...(controllerKind === undefined ? {} : { controllerKind }),
    };
    expect(deviceProgramTimingOptions(device, 'laser').plannerBlocks).toBe(blocks);
    expect(deviceProgramTimingOptions(device, 'cnc').plannerBlocks).toBe(blocks);
  });

  it('plans the timeline of a GRBL device with its planner', () => {
    const device = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grbl-v1.1' as const };
    const timeline = buildProgramTimeline(RASTER_ROW, LIMITS, {
      ...deviceProgramTimingOptions(device, 'laser'),
      initialPositionMm: { x: 0, y: 0, z: 0 },
    });
    if (timeline.kind !== 'ok') throw new Error(timeline.reason);
    expect(timeline.timeline.motionSeconds).toBeCloseTo(fifteenBlockRowSeconds(500), 6);
  });
});
