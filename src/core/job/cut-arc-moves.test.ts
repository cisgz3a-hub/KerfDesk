// ADR-407: compile attaches fitted arc moves to laser line cuts on
// arc-capable machines, and every stage that rewrites a cut keeps them
// exact or drops them; bounds follow the arcs, not their chords.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import type { ArcMove } from '../geometry/arc-fit';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Layer,
} from '../scene';
import { compileJob } from './compile-job';
import { validCutArcMoves } from './cut-arc-moves';
import type { CutGroup, CutSegment, Job } from './job';
import { computeJobBounds } from './job-bounds';
import { applyJobOriginOffset } from './job-origin';
import { optimizePaths } from './optimize-paths';
import { removeCutOverlaps } from './remove-cut-overlaps';
import { applyRotaryYScale } from './rotary-transform';
import { buildToolpath } from './toolpath';

const ARC_DEVICE: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grbl-v1.1' };
const KAPPA = (4 / 3) * Math.tan(Math.PI / 8);

function circle(cx: number, cy: number, r: number): CurveSubpath {
  const k = KAPPA * r;
  return {
    start: { x: cx + r, y: cy },
    closed: true,
    segments: [
      {
        kind: 'cubic',
        control1: { x: cx + r, y: cy + k },
        control2: { x: cx + k, y: cy + r },
        to: { x: cx, y: cy + r },
      },
      {
        kind: 'cubic',
        control1: { x: cx - k, y: cy + r },
        control2: { x: cx - r, y: cy + k },
        to: { x: cx - r, y: cy },
      },
      {
        kind: 'cubic',
        control1: { x: cx - r, y: cy - k },
        control2: { x: cx - k, y: cy - r },
        to: { x: cx, y: cy - r },
      },
      {
        kind: 'cubic',
        control1: { x: cx + k, y: cy - r },
        control2: { x: cx + r, y: cy - k },
        to: { x: cx + r, y: cy },
      },
    ],
  };
}

function svgWith(curves: ReadonlyArray<CurveSubpath>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'svg',
    source: 'shapes.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: curves.map((curve) => ({ points: [curve.start], closed: curve.closed })),
        curves,
      },
    ],
  };
}

function compileCut(
  device: DeviceProfile,
  layer: Layer = createLayer({ id: 'l', color: '#000000' }),
): CutGroup {
  const job = compileJob({ objects: [svgWith([circle(50, 40, 10)])], layers: [layer] }, device);
  const group = job.groups[0];
  if (group?.kind !== 'cut') throw new Error('expected a cut group');
  return group;
}

function only(group: CutGroup): CutSegment {
  const segment = group.segments[0];
  if (segment === undefined) throw new Error('expected a segment');
  return segment;
}

describe('compile attaches laser arc moves (ADR-407)', () => {
  it('fits a circle with a few arcs and leaves the compiled chords untouched', () => {
    const withArcs = only(compileCut(ARC_DEVICE));
    const without = only(compileCut({ ...ARC_DEVICE, laserArcMoves: 'off' }));
    expect(withArcs.polyline).toEqual(without.polyline);
    expect(without.arcMoves).toBeUndefined();
    const moves = validCutArcMoves(withArcs);
    expect(moves).not.toBeNull();
    expect(moves?.length).toBeLessThanOrEqual(4);
    expect(moves?.filter((move) => move.kind === 'arc').length).toBeGreaterThanOrEqual(2);
  });

  it('attaches nothing where the machine is not known to take arcs', () => {
    expect(only(compileCut(DEFAULT_DEVICE_PROFILE)).arcMoves).toBeUndefined();
    const rotary: DeviceProfile = {
      ...ARC_DEVICE,
      rotary: { enabled: true, type: 'roller', mmPerRotation: 100, objectDiameterMm: 40 },
    };
    expect(only(compileCut(rotary)).arcMoves).toBeUndefined();
  });

  it('attaches nothing to kerf-offset contours', () => {
    const layer = { ...createLayer({ id: 'l', color: '#000000' }), kerfOffsetMm: 0.1 };
    expect(only(compileCut(ARC_DEVICE, layer)).arcMoves).toBeUndefined();
  });
});

// A half-turn made of two clockwise quarters over the top of (20, 20), radius
// 10, stored against a polyline of just its two ends: its chord hull is flat.
const HALF_TURN: ReadonlyArray<ArcMove> = [
  { kind: 'arc', to: { x: 20, y: 30 }, center: { x: 20, y: 20 }, clockwise: true },
  { kind: 'arc', to: { x: 30, y: 20 }, center: { x: 20, y: 20 }, clockwise: true },
];
const HALF_TURN_SEGMENT: CutSegment = {
  polyline: [
    { x: 10, y: 20 },
    { x: 30, y: 20 },
  ],
  closed: false,
  arcMoves: HALF_TURN,
};

function cutJob(segments: ReadonlyArray<CutSegment>): Job {
  return {
    groups: [
      {
        kind: 'cut',
        layerId: 'l',
        color: '#000000',
        power: 50,
        speed: 1500,
        passes: 1,
        airAssist: false,
        segments,
      },
    ],
  };
}

describe('readers of cut arc moves (ADR-407)', () => {
  it('bounds a half-turn by its apex, not its chord hull', () => {
    expect(computeJobBounds(cutJob([HALF_TURN_SEGMENT]))).toEqual({
      minX: 10,
      minY: 20,
      maxX: 30,
      maxY: 30,
    });
  });

  it('draws the preview along the arcs', () => {
    const cut = buildToolpath(cutJob([HALF_TURN_SEGMENT])).steps.find(
      (step) => step.kind === 'cut',
    );
    if (cut?.kind !== 'cut') throw new Error('expected a cut step');
    expect(Math.max(...cut.polyline.map((point) => point.y))).toBeCloseTo(30, 3);
    expect(cut.length).toBeCloseTo(10 * Math.PI, 1);
  });

  it('translates the arcs with the job origin', () => {
    const moved = applyJobOriginOffset(cutJob([HALF_TURN_SEGMENT]), { x: 5, y: -3 });
    const group = moved.groups[0] as CutGroup;
    const segment = only(group);
    expect(validCutArcMoves(segment)).not.toBeNull();
    expect(computeJobBounds(moved)).toEqual({ minX: 15, minY: 17, maxX: 35, maxY: 27 });
  });

  it('reverses the arcs with the segment', () => {
    // Stored from the far end, so the optimizer enters it at (10, 20).
    const farFirst: CutSegment = {
      polyline: [
        { x: 30, y: 20 },
        { x: 10, y: 20 },
      ],
      closed: false,
      arcMoves: [
        { kind: 'arc', to: { x: 20, y: 30 }, center: { x: 20, y: 20 }, clockwise: false },
        { kind: 'arc', to: { x: 10, y: 20 }, center: { x: 20, y: 20 }, clockwise: false },
      ],
    };
    const optimized = optimizePaths(cutJob([farFirst]));
    const segment = only(optimized.groups[0] as CutGroup);
    expect(segment.polyline[0]).toEqual({ x: 10, y: 20 });
    expect(validCutArcMoves(segment)).toEqual(HALF_TURN);
  });

  it('drops the arcs where a rotary rescales Y', () => {
    const scaled = applyRotaryYScale(cutJob([HALF_TURN_SEGMENT]), 2);
    expect(only(scaled.groups[0] as CutGroup).arcMoves).toBeUndefined();
  });

  it('drops the arcs from pieces that overlap removal splits off', () => {
    const shared: CutSegment = {
      polyline: [
        { x: 10, y: 20 },
        { x: 30, y: 20 },
      ],
      closed: false,
    };
    const group = removeCutOverlaps(cutJob([shared, HALF_TURN_SEGMENT]).groups[0] as CutGroup);
    for (const segment of group.segments) {
      expect(segment.arcMoves === undefined || validCutArcMoves(segment) !== null).toBe(true);
    }
  });
});
