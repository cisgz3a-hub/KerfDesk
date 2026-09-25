// ADR-407: compile attaches fitted arc moves to laser line cuts on
// arc-capable machines, and every stage that rewrites a cut keeps them
// exact or drops them; bounds follow the arcs, not their chords.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { buildGcodeRenderModel } from '../gcode-view';
import { GRBL_DEFAULT_ARC_TOLERANCE_MM } from '../gcode-view/controller-arc-points';
import { grblStrategy } from '../output/grbl-strategy';
import type { ArcMove } from '../geometry/arc-fit';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Layer,
} from '../scene';
import { compileJob } from './compile-job';
import { validCutArcMoves, withCutArcMoves } from './cut-arc-moves';
import type { CutGroup, CutSegment, Job } from './job';
import { computeFrameJobBounds, computeJobBounds } from './job-bounds';
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
const HALF_TURN_SEGMENT: CutSegment = withCutArcMoves(
  {
    polyline: [
      { x: 10, y: 20 },
      { x: 30, y: 20 },
    ],
    closed: false,
  },
  HALF_TURN,
);

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
    const farFirst: CutSegment = withCutArcMoves(
      {
        polyline: [
          { x: 30, y: 20 },
          { x: 10, y: 20 },
        ],
        closed: false,
      },
      [
        { kind: 'arc', to: { x: 20, y: 30 }, center: { x: 20, y: 20 }, clockwise: false },
        { kind: 'arc', to: { x: 10, y: 20 }, center: { x: 20, y: 20 }, clockwise: false },
      ],
    );
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

  it('distrusts arcs once the polyline no longer matches their fingerprint', () => {
    // A stage that rewrites the head of the polyline and keeps its tail.
    const lineFirst = withCutArcMoves(
      {
        polyline: [
          { x: 0, y: 20 },
          { x: 10, y: 20 },
          { x: 30, y: 20 },
        ],
        closed: false,
      },
      [{ kind: 'line', to: { x: 10, y: 20 } }, ...HALF_TURN],
    );
    expect(validCutArcMoves(lineFirst)).not.toBeNull();
    const newHead = { ...lineFirst, polyline: [{ x: 3, y: 20 }, ...lineFirst.polyline.slice(1)] };
    expect(validCutArcMoves(newHead)).toBeNull();
    const newMiddle = {
      ...lineFirst,
      polyline: [lineFirst.polyline[0], { x: 10, y: 21 }, lineFirst.polyline[2]],
    } as CutSegment;
    expect(validCutArcMoves(newMiddle)).toBeNull();
    const extraPoint = {
      ...lineFirst,
      polyline: [...lineFirst.polyline.slice(0, 2), { x: 20, y: 20 }, lineFirst.polyline[2]],
    } as CutSegment;
    expect(validCutArcMoves(extraPoint)).toBeNull();
  });

  it('bounds by what the emitter writes for the machine', () => {
    const job = cutJob([HALF_TURN_SEGMENT]);
    const chordHull = { minX: 10, minY: 20, maxX: 30, maxY: 20 };
    expect(computeFrameJobBounds(job, ARC_DEVICE)?.maxY).toBe(30);
    expect(computeFrameJobBounds(job, { ...ARC_DEVICE, laserArcMoves: 'off' })).toEqual(chordHull);
    const withRunway: Job = {
      groups: [{ ...(job.groups[0] as CutGroup), entryRunwayMm: 2 }],
    };
    expect(computeJobBounds(withRunway, ARC_DEVICE)).toEqual(chordHull);
  });

  it('bounds the arc GRBL runs about its rounded words, not only the fitted one', () => {
    // Fitted: centre (20, 20), radius 10.5, from 135 to 45 degrees over the top.
    // Rounding the start to (12.575, 27.425) lengthens the radius GRBL derives
    // by 0.00054 mm, and 40 mc_arc chords put a vertex at the apex.
    const radius = 10.5;
    const at = (degrees: number) => ({
      x: 20 + radius * Math.cos((degrees * Math.PI) / 180),
      y: 20 + radius * Math.sin((degrees * Math.PI) / 180),
    });
    const segment = withCutArcMoves({ polyline: [at(135), at(45)], closed: false }, [
      { kind: 'arc', to: at(45), center: { x: 20, y: 20 }, clockwise: true },
    ]);
    const job = cutJob([segment]);
    const gcode = grblStrategy.emit(job, ARC_DEVICE);
    expect(gcode).toContain('G2 X27.425 Y27.425 I7.425 J-7.425');
    const parsed = buildGcodeRenderModel(gcode, {
      machineKind: 'laser',
      controllerArcToleranceMm: GRBL_DEFAULT_ARC_TOLERANCE_MM,
    });
    if (parsed.kind !== 'ok') throw new Error(parsed.reason);
    const executedTop = parsed.model.stats.cutBounds?.maxY ?? 0;
    expect(executedTop).toBeGreaterThan(20 + radius + 0.0004);
    expect(computeFrameJobBounds(job, ARC_DEVICE)?.maxY).toBeGreaterThanOrEqual(executedTop - 2e-5);
  });

  it('holds every executed point of rounded, off-grid arcs inside the Frame bounds', () => {
    const polylines = [];
    for (let k = 0; k < 120; k += 1) {
      const radius = 0.3 + (k % 40) * 0.36 + k * 0.0013;
      const cx = 20 + (k % 12) * 31.7 + 0.00037 * k;
      const cy = 20 + Math.floor(k / 12) * 31.3 + 0.00071 * k;
      const points = Array.from({ length: 64 }, (_, step) => {
        const angle = (step * 2 * Math.PI) / 64 + k * 0.01;
        return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
      });
      polylines.push({ points, closed: true });
    }
    const svg: ImportedSvg = {
      kind: 'imported-svg',
      id: 'rings',
      source: 'rings.svg',
      bounds: { minX: 0, minY: 0, maxX: 400, maxY: 400 },
      transform: IDENTITY_TRANSFORM,
      paths: [{ color: '#000000', polylines }],
    };
    const job = compileJob(
      { objects: [svg], layers: [createLayer({ id: 'l', color: '#000000' })] },
      ARC_DEVICE,
    );
    const gcode = grblStrategy.emit(job, ARC_DEVICE);
    expect(gcode.match(/^G[23] /gm)?.length ?? 0).toBeGreaterThan(100);
    const parsed = buildGcodeRenderModel(gcode, {
      machineKind: 'laser',
      controllerArcToleranceMm: GRBL_DEFAULT_ARC_TOLERANCE_MM,
    });
    if (parsed.kind !== 'ok') throw new Error(parsed.reason);
    const executed = parsed.model.stats.cutBounds;
    const frame = computeFrameJobBounds(job, ARC_DEVICE);
    if (executed === null || frame === null) throw new Error('expected bounds');
    // The parser stores float32 positions: allow their spacing, nothing more.
    const float32 = 2e-5;
    expect(executed.minX).toBeGreaterThanOrEqual(frame.minX - float32);
    expect(executed.minY).toBeGreaterThanOrEqual(frame.minY - float32);
    expect(executed.maxX).toBeLessThanOrEqual(frame.maxX + float32);
    expect(executed.maxY).toBeLessThanOrEqual(frame.maxY + float32);
  });
});
