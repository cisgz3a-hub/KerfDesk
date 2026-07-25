import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import { playheadAt, segmentIndexAtRoute } from './playhead';

function model(text: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(text);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

// Three 10 mm moves: travel to (10,0), cut to (20,0), cut to (20,10).
const PROGRAM = ['G21 G90', 'G0 X10 Y0', 'G1 X20 Y0 F600', 'G1 X20 Y10'].join('\n');

describe('playheadAt', () => {
  it('interpolates within the active segment rather than snapping', () => {
    const state = playheadAt(model(PROGRAM), 15);
    expect(state.segmentIndex).toBe(1);
    expect(state.point?.x).toBeCloseTo(15, 6);
    expect(state.point?.y).toBeCloseTo(0, 6);
    expect(state.segmentFraction).toBeCloseTo(0.5, 6);
  });

  it('clamps below zero and beyond the program end', () => {
    const built = model(PROGRAM);
    const start = playheadAt(built, -5);
    expect(start.routeMm).toBe(0);
    expect(start.point?.x).toBeCloseTo(0, 6);

    const end = playheadAt(built, 999);
    expect(end.routeMm).toBeCloseTo(30, 6);
    expect(end.segmentIndex).toBe(2);
    expect(end.point?.x).toBeCloseTo(20, 6);
    expect(end.point?.y).toBeCloseTo(10, 6);
  });

  it('reports no point for a motionless program', () => {
    const state = playheadAt(model('G21 G90\nM3 S0\nM5'), 5);
    expect(state.segmentIndex).toBe(-1);
    expect(state.point).toBeNull();
  });
});

describe('segmentIndexAtRoute', () => {
  it('finds the segment containing each route position', () => {
    const built = model(PROGRAM);
    expect(segmentIndexAtRoute(built, 0)).toBe(0);
    expect(segmentIndexAtRoute(built, 9.9)).toBe(0);
    expect(segmentIndexAtRoute(built, 10)).toBe(0);
    expect(segmentIndexAtRoute(built, 10.1)).toBe(1);
    expect(segmentIndexAtRoute(built, 25)).toBe(2);
  });
});
