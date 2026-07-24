// H.9 motion polish: climb/conventional orientation, mid-segment entry
// rotation, along-path ramp entries, and parking parity. All opt-in — the
// snapshot corpus separately pins that defaults stay byte-identical.

import { describe, expect, it } from 'vitest';
import { isCounterClockwise, signedAreaMm2 } from '../geometry/polyline-orientation';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncGrblStrategy } from '../output';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type ImportedSvg,
  type Polyline,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';
import { applyRampEntry, enforceCutDirection, rotateStartToLongestSegment } from './motion-polish';

// CCW unit square (Y-up frame, shoelace positive).
const CCW_SQUARE: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
};

describe('enforceCutDirection', () => {
  it('outside-profile climb wants counter-clockwise; conventional reverses', () => {
    const climb = enforceCutDirection([CCW_SQUARE], 'climb', 'profile-outside');
    expect(isCounterClockwise(climb[0] as Polyline)).toBe(true);
    const conventional = enforceCutDirection([CCW_SQUARE], 'conventional', 'profile-outside');
    expect(isCounterClockwise(conventional[0] as Polyline)).toBe(false);
  });

  it('inside/pocket climb wants clockwise (material lies outside the boundary)', () => {
    const inside = enforceCutDirection([CCW_SQUARE], 'climb', 'profile-inside');
    expect(isCounterClockwise(inside[0] as Polyline)).toBe(false);
    const pocket = enforceCutDirection([CCW_SQUARE], 'climb', 'pocket');
    expect(isCounterClockwise(pocket[0] as Polyline)).toBe(false);
  });

  it('leaves engraves and open paths untouched', () => {
    const open: Polyline = { closed: false, points: CCW_SQUARE.points };
    expect(enforceCutDirection([open], 'climb', 'profile-outside')[0]).toBe(open);
    expect(enforceCutDirection([CCW_SQUARE], 'climb', 'engrave')[0]).toBe(CCW_SQUARE);
  });

  it('preserves the enclosed area when reversing and rotating', () => {
    const result = enforceCutDirection([CCW_SQUARE], 'conventional', 'profile-outside');
    expect(Math.abs(signedAreaMm2((result[0] as Polyline).points))).toBeCloseTo(100, 6);
  });

  // ADR-252: a hole's material lies outside its boundary, so it is cut in the
  // mirrored direction and stays wound OPPOSITE the outer — both cutting the
  // right material side and preserving the winding opposition ADR-250 reads to
  // aim the hole's lead into the slug rather than the kept part.
  it('mirrors a hole so it stays wound opposite the outer', () => {
    const outer: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    }; // CCW, area +10000 (the largest contour → the outer reference)
    const hole: Polyline = {
      closed: true,
      points: [
        { x: 40, y: 40 },
        { x: 40, y: 60 },
        { x: 60, y: 60 },
        { x: 60, y: 40 },
      ],
    }; // CW, area -400 (wound opposite the outer, as the kerf offset produces)
    for (const direction of ['climb', 'conventional'] as const) {
      const result = enforceCutDirection([outer, hole], direction, 'profile-outside');
      const orientedOuter = result[0] as Polyline;
      const orientedHole = result[1] as Polyline;
      // The outer follows the requested direction; the hole stays its mirror.
      expect(isCounterClockwise(orientedOuter)).toBe(direction === 'climb');
      expect(isCounterClockwise(orientedHole)).toBe(!isCounterClockwise(orientedOuter));
    }
  });
});

describe('rotateStartToLongestSegment', () => {
  it('starts the loop at the midpoint of its longest edge', () => {
    const rectangle: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 10 },
        { x: 0, y: 10 },
      ],
    };
    const rotated = rotateStartToLongestSegment(rectangle);
    // Longest edges are the 40 mm horizontals; the first one wins.
    expect(rotated.points[0]).toEqual({ x: 20, y: 0 });
    expect(rotated.points).toHaveLength(5);
  });
});

describe('applyRampEntry', () => {
  it('descends along the path at the configured angle, then re-cuts the ramp span', () => {
    const pass = {
      kind: 'contour' as const,
      zMm: -2,
      closed: true,
      polyline: CCW_SQUARE.points,
    };
    const [ramped] = applyRampEntry([pass], 10);
    if (ramped?.kind !== 'path3d') throw new Error('ramped pass must be path3d');
    // Ramp length = 2 / tan(10°) ≈ 11.34 mm — crosses the first corner.
    const first = ramped.points[0];
    expect(first).toEqual({ x: 0, y: 0, z: 0 });
    // Z never rises mid-ramp and ends at the pass depth.
    let previous = 0;
    for (const point of ramped.points) {
      expect(point.z).toBeLessThanOrEqual(previous + 1e-9);
      previous = Math.min(previous, point.z);
    }
    expect(ramped.points.at(-1)?.z).toBe(-2);
    // The descent rate along the path matches tan(10°) within one segment.
    const second = ramped.points[1];
    if (second === undefined) throw new Error('ramp vertex missing');
    const run = Math.hypot(second.x - 0, second.y - 0);
    const drop = 0 - second.z;
    expect(drop / run).toBeCloseTo(Math.tan((10 * Math.PI) / 180), 6);
  });

  it('ramps each depth step from the previous level in a contour ladder', () => {
    const passes = applyRampEntry(
      [
        { kind: 'contour' as const, zMm: -1.5, closed: true, polyline: CCW_SQUARE.points },
        { kind: 'contour' as const, zMm: -3, closed: true, polyline: CCW_SQUARE.points },
      ],
      15,
    );
    const second = passes[1];
    if (second?.kind !== 'path3d') throw new Error('second ramped pass missing');
    expect(second.points[0]?.z).toBe(-1.5);
    expect(second.points.at(-1)?.z).toBe(-3);
  });

  it('does not backtrack when the ramp spans past the first segment', () => {
    // 10 mm square, 2 mm deep, 10° ramp → ramp length ≈ 11.34 mm, so the descent
    // crosses the first corner and reaches full depth partway up the SECOND edge
    // at (10, ~1.34). The at-depth remainder must continue FORWARD to (10,10);
    // the bug resumed the walk at (10,0) — a reverse move back down the edge just
    // ramped (a re-cut on straight edges, a cross-arc gouge on curves).
    const pass = { kind: 'contour' as const, zMm: -2, closed: true, polyline: CCW_SQUARE.points };
    const [ramped] = applyRampEntry([pass], 10);
    if (ramped?.kind !== 'path3d') throw new Error('ramped pass must be path3d');
    const rampEndIndex = ramped.points.findIndex((point) => Math.abs(point.z - -2) < 1e-9);
    const rampEnd = ramped.points[rampEndIndex];
    const afterRamp = ramped.points[rampEndIndex + 1];
    if (rampEnd === undefined || afterRamp === undefined) throw new Error('ramp end missing');
    // The ramp ends on the right edge (x=10) heading +y; the next move must keep
    // going up that edge, never step back toward y=0.
    expect(Math.abs(rampEnd.x - 10)).toBeLessThan(1e-9);
    expect(Math.abs(afterRamp.x - 10)).toBeLessThan(1e-9);
    expect(afterRamp.y).toBeGreaterThan(rampEnd.y);
  });
});

describe('parking parity (compile → emit)', () => {
  function squareScene(): Scene {
    const object: ImportedSvg = {
      kind: 'imported-svg',
      id: 'O1',
      source: 'square.svg',
      bounds: { minX: 10, minY: 10, maxX: 30, maxY: 30 },
      transform: IDENTITY_TRANSFORM,
      paths: [{ color: '#ff0000', polylines: [CCW_SQUARE] }],
    };
    const layer = {
      ...createLayer({ id: '#ff0000', color: '#ff0000' }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave', depthMm: 1 } as CncLayerSettings,
    };
    return { objects: [object], layers: [layer] };
  }

  it('parks at the configured position; default stays at the origin', () => {
    const parked = cncGrblStrategy.emit(
      compileCncJob(squareScene(), DEFAULT_DEVICE_PROFILE, {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, parkXMm: 350, parkYMm: 5 },
      }),
      DEFAULT_DEVICE_PROFILE,
    );
    expect(parked.trimEnd().split('\n').at(-1)).toBe('G0 X350.000 Y5.000');

    const defaulted = cncGrblStrategy.emit(
      compileCncJob(squareScene(), DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG),
      DEFAULT_DEVICE_PROFILE,
    );
    expect(defaulted.trimEnd().split('\n').at(-1)).toBe('G0 X0.000 Y0.000');
  });
});
