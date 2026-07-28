import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { grblStrategy } from '../output';
import type { Vec2 } from '../scene';
import { isEmittableFillSegment } from './fill-emission-resolution';
import { planFillSweeps } from './fill-sweep-plan';
import type { FillGroup, FillSegment } from './job';
import { computeJobMotionBounds } from './job-bounds';

const CALIBRATED_OFFSET_MM = 0.0004;

function segment(start: Vec2, end: Vec2): FillSegment {
  return {
    polyline: [start, end],
    closed: false,
    reverse: false,
  };
}

function reverseSegment(start: Vec2, end: Vec2): FillSegment {
  return { ...segment(start, end), reverse: true };
}

function group(candidate: FillSegment, scanOffsetMm?: number): FillGroup {
  return {
    kind: 'fill',
    layerId: 'micro-fill',
    color: '#000000',
    power: 30,
    speed: 1500,
    passes: 1,
    airAssist: false,
    fillStyle: 'scanline',
    fillRunwayPolicy: 'feed-matched-every-sweep',
    overscanMm: 5,
    ...(scanOffsetMm === undefined ? {} : { bidirectionalScanOffsetMm: scanOffsetMm }),
    segments: [candidate],
  };
}

describe('isEmittableFillSegment', () => {
  it('retains a sub-millimetre move when its emitted coordinates differ', () => {
    expect(isEmittableFillSegment(segment({ x: 10.0004, y: 4 }, { x: 10.0012, y: 4 }))).toBe(true);
  });

  it('drops a diagonal millimetre-resolution move when both coordinates format stationary', () => {
    const delta = 0.001 / Math.sqrt(2);
    expect(
      isEmittableFillSegment(
        segment({ x: 10.0006, y: 4.0006 }, { x: 10.0006 + delta, y: 4.0006 + delta }),
      ),
    ).toBe(false);
  });

  it('does not plan, frame, or emit a runway for a coordinate-stationary sweep', () => {
    const delta = 0.001 / Math.sqrt(2);
    const microGroup = group(
      segment({ x: 10.0006, y: 4.0006 }, { x: 10.0006 + delta, y: 4.0006 + delta }),
    );
    const gcode = grblStrategy.emit({ groups: [microGroup] }, DEFAULT_DEVICE_PROFILE);
    const bounds = computeJobMotionBounds({ groups: [microGroup] }, DEFAULT_DEVICE_PROFILE);

    expect(planFillSweeps(microGroup)).toEqual([]);
    expect(bounds).toBeNull();
    expect(gcode).not.toContain('kerfdesk:laser-off-motion');
    expect(gcode).not.toMatch(/\bS300\b/);
  });

  it('does not plan or emit a signed-zero stationary powered move', () => {
    const signedZeroGroup = group(segment({ x: -0.0004, y: 4 }, { x: 0.0004, y: 4 }));
    const gcode = grblStrategy.emit({ groups: [signedZeroGroup] }, DEFAULT_DEVICE_PROFILE);

    expect(planFillSweeps(signedZeroGroup)).toEqual([]);
    expect(gcode).not.toContain('kerfdesk:laser-off-motion');
    expect(gcode).not.toMatch(/\bS300\b/);
  });

  it('filters after scan-offset translation when a reverse sweep collapses', () => {
    const candidate = group(
      reverseSegment({ x: 10.0012, y: 4 }, { x: 10.0004, y: 4 }),
      2 * CALIBRATED_OFFSET_MM,
    );
    const gcode = grblStrategy.emit({ groups: [candidate] }, DEFAULT_DEVICE_PROFILE);

    expect(planFillSweeps(candidate, 2 * CALIBRATED_OFFSET_MM)).toEqual([]);
    expect(computeJobMotionBounds({ groups: [candidate] }, DEFAULT_DEVICE_PROFILE)).toBeNull();
    expect(gcode).not.toContain('kerfdesk:laser-off-motion');
    expect(gcode).not.toMatch(/\bS300\b/);
  });

  it('retains a reverse sweep that becomes moving after scan-offset translation', () => {
    const candidate = group(
      reverseSegment({ x: 10.0004, y: 4 }, { x: 9.9996, y: 4 }),
      CALIBRATED_OFFSET_MM,
    );
    const gcode = grblStrategy.emit({ groups: [candidate] }, DEFAULT_DEVICE_PROFILE);

    expect(planFillSweeps(candidate, CALIBRATED_OFFSET_MM)).toHaveLength(1);
    expect(gcode).toContain('G1 X9.999 Y4.000 F1500 S300');
  });
});
