// LBG-C04: rotateClosedCutSegment starts a closed loop at another vertex and
// keeps its arc moves (ADR-432) exact, or refuses rather than drop them.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { sampleArcMoves } from '../geometry/arc-fit';
import { grblStrategy } from '../output/grbl-strategy';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Vec2,
} from '../scene';
import { compileJob } from './compile-job';
import {
  arcRotatableVertices,
  rotateClosedCutSegment,
  validCutArcMoves,
  withCutArcMoves,
  withoutArcMoves,
} from './cut-arc-moves';
import type { CutSegment, Job } from './job';

const ARC_DEVICE: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grbl-v1.1' };

function closed(points: ReadonlyArray<readonly [number, number]>): CutSegment {
  const polyline = points.map(([x, y]) => ({ x, y }));
  return { closed: true, polyline: [...polyline, polyline[0] as Vec2] };
}

// The right side bulges as one arc through a chord vertex at (12, 5).
const BULGED = closed([
  [0, 0],
  [10, 0],
  [12, 5],
  [10, 10],
  [0, 10],
]);
const BULGED_WITH_ARCS = withCutArcMoves(BULGED, [
  { kind: 'line', to: { x: 10, y: 0 } },
  { kind: 'arc', to: { x: 10, y: 10 }, center: { x: 5, y: 5 }, clockwise: false },
  { kind: 'line', to: { x: 0, y: 10 } },
  { kind: 'line', to: { x: 0, y: 0 } },
]);

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

describe('rotateClosedCutSegment', () => {
  it('starts the loop at the vertex and closes it there', () => {
    const rotated = rotateClosedCutSegment(BULGED, 3);
    expect(rotated?.polyline).toEqual([
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 12, y: 5 },
      { x: 10, y: 10 },
    ]);
    expect(rotated?.closed).toBe(true);
  });

  it('returns the segment itself at vertex 0 and null where it cannot start', () => {
    expect(rotateClosedCutSegment(BULGED, 0)).toBe(BULGED);
    expect(rotateClosedCutSegment({ ...BULGED, closed: false }, 2)).toBeNull();
    for (const index of [-1, 5, 6, 1.5, Number.NaN]) {
      expect(rotateClosedCutSegment(BULGED, index)).toBeNull();
    }
  });

  it('rotates the arc moves at the same point', () => {
    const rotated = rotateClosedCutSegment(BULGED_WITH_ARCS, 3);
    if (rotated === null) throw new Error('expected a rotation');
    expect(rotated.polyline[0]).toEqual({ x: 10, y: 10 });
    expect(validCutArcMoves(rotated)).toEqual([
      { kind: 'line', to: { x: 0, y: 10 } },
      { kind: 'line', to: { x: 0, y: 0 } },
      { kind: 'line', to: { x: 10, y: 0 } },
      { kind: 'arc', to: { x: 10, y: 10 }, center: { x: 5, y: 5 }, clockwise: false },
    ]);
  });

  it('refuses a vertex no move ends on instead of dropping the arcs', () => {
    expect(arcRotatableVertices(BULGED_WITH_ARCS)).toEqual(
      new Map([
        [1, 0],
        [3, 1],
        [4, 2],
      ]),
    );
    expect(rotateClosedCutSegment(BULGED_WITH_ARCS, 2)).toBeNull();
  });

  it('refuses to rotate arcs round a loop that does not close bit for bit', () => {
    const polyline = [...BULGED.polyline.slice(0, -1), { x: 1e-12, y: 0 }];
    const gapped = withCutArcMoves({ closed: true, polyline }, [
      ...(validCutArcMoves(BULGED_WITH_ARCS) ?? []).slice(0, -1),
      { kind: 'line', to: { x: 1e-12, y: 0 } },
    ]);
    expect(validCutArcMoves(gapped)).not.toBeNull();
    expect(arcRotatableVertices(gapped)?.size).toBe(0);
    expect(rotateClosedCutSegment(gapped, 1)).toBeNull();
    expect(rotateClosedCutSegment(withoutArcMoves(gapped), 1)).not.toBeNull();
  });

  it('drops arc moves that no longer matched the polyline, as reversal does', () => {
    const stale = {
      ...BULGED_WITH_ARCS,
      polyline: BULGED.polyline.map((p) => ({ ...p, x: p.x + 1 })),
    };
    const rotated = rotateClosedCutSegment(stale, 2);
    expect(rotated).not.toBeNull();
    expect(rotated?.arcMoves).toBeUndefined();
  });

  it('keeps compiled arcs emitting as G2/G3 from every start it offers', () => {
    const segment = compiledD();
    const moves = validCutArcMoves(segment);
    if (moves === null) throw new Error('expected compiled arc moves');
    const starts = arcRotatableVertices(segment);
    expect(starts?.size ?? 0).toBeGreaterThan(0);
    const length = pathLength(sampleArcMoves(segment.polyline[0] as Vec2, moves, 0.001));
    for (const vertexIndex of starts?.keys() ?? []) {
      const rotated = rotateClosedCutSegment(segment, vertexIndex);
      if (rotated === null) throw new Error(`vertex ${vertexIndex} did not rotate`);
      const rotatedMoves = validCutArcMoves(rotated);
      if (rotatedMoves === null) throw new Error(`vertex ${vertexIndex} lost its arcs`);
      expect(rotatedMoves).toHaveLength(moves.length);
      const start = rotated.polyline[0] as Vec2;
      expect(start).toEqual(segment.polyline[vertexIndex]);
      expect(pathLength(sampleArcMoves(start, rotatedMoves, 0.001))).toBeCloseTo(length, 6);
      const gcode = grblStrategy.emit(cutJob([rotated]), ARC_DEVICE);
      expect(gcode).toMatch(/^G[23] /m);
    }
  });
});

// A D: flat bottom from (10, 10) to (30, 10), a half circle over the top,
// drawn from the arc's apex so the drawn start is not a corner.
function compiledD(): CutSegment {
  const k = (4 / 3) * Math.tan(Math.PI / 8) * 10;
  const curve = {
    start: { x: 20, y: 20 },
    closed: true,
    segments: [
      {
        kind: 'cubic',
        control1: { x: 20 - k, y: 20 },
        control2: { x: 10, y: 10 + k },
        to: { x: 10, y: 10 },
      },
      { kind: 'line', to: { x: 30, y: 10 } },
      {
        kind: 'cubic',
        control1: { x: 30, y: 10 + k },
        control2: { x: 20 + k, y: 20 },
        to: { x: 20, y: 20 },
      },
    ],
  } as CurveSubpath;
  const svg: ImportedSvg = {
    kind: 'imported-svg',
    id: 'd',
    source: 'd.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      { color: '#000000', polylines: [{ points: [curve.start], closed: true }], curves: [curve] },
    ],
  };
  const job = compileJob(
    { objects: [svg], layers: [createLayer({ id: 'l', color: '#000000' })] },
    ARC_DEVICE,
  );
  const group = job.groups[0];
  const segment = group?.kind === 'cut' ? group.segments[0] : undefined;
  if (segment === undefined) throw new Error('expected a compiled segment');
  return segment;
}

function pathLength(points: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Vec2;
    const b = points[index] as Vec2;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}
