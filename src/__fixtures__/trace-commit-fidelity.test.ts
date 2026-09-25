import { describe, expect, it } from 'vitest';
import { compilationPolylines } from '../core/job/compilation-polylines';
import {
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type Vec2,
} from '../core/scene';
import { traceCommitFidelity } from './trace-commit-fidelity';
import { traceCommitTopology } from './trace-commit-topology';

function line(points: readonly Vec2[], closed = false): Polyline {
  return { points, closed };
}
function path(lines: readonly Polyline[], canonical = true): ColoredPath {
  return {
    color: '#000000',
    polylines: lines,
    ...(canonical ? { curves: lines.map(polylineToCurveSubpath) } : {}),
  };
}
const WAVY = line([
  { x: 0, y: 0 },
  { x: 1, y: 0.01 },
  { x: 2, y: 0 },
]);
const CHORD = line([
  { x: 0, y: 0 },
  { x: 2, y: 0 },
]);
const inspect = (source: ColoredPath[], saved: ColoredPath[]) =>
  traceCommitFidelity(source, saved, IDENTITY_TRANSFORM);

function circle(radius: number, phase = 0, x = 0): Polyline {
  const points = Array.from({ length: 128 }, (_, index) => ({
    x: x + radius * Math.cos((index * Math.PI) / 64 + phase),
    y: radius * Math.sin((index * Math.PI) / 64 + phase),
  }));
  return line([...points, points[0] as Vec2], true);
}

describe('trace commit acceptance oracle', () => {
  it('accepts bounded compaction and save omission of redundant canonical lines', () => {
    const result = inspect([path([WAVY])], [path([CHORD], false)]);
    expect(result.issues).toEqual([]);
    expect(result.sourceVertices).toBe(3);
    expect(result.committedVertices).toBe(2);
    expect(result.maximumDeviationBoundMm).toBeCloseTo(0.01, 12);
  });

  it.each([
    ['missing path', []],
    ['missing contour', [path([])]],
    ['empty contour', [path([line([])])]],
    [
      'non-finite contour',
      [
        path([
          line([
            { x: NaN, y: 0 },
            { x: 2, y: 0 },
          ]),
        ]),
      ],
    ],
  ])('rejects %s instead of passing a vacuous geometry comparison', (_name, saved) => {
    expect(inspect([path([WAVY])], saved as ColoredPath[]).issues.length).toBeGreaterThan(0);
  });

  it('rejects moved endpoints, reordered vertices and changed path metadata', () => {
    const changed = path([
      line([
        { x: 0.001, y: 0 },
        { x: 2, y: 0 },
      ]),
    ]);
    expect(inspect([path([WAVY])], [changed]).issues.join()).toContain('subsequence');
    expect(
      inspect([path([WAVY])], [{ ...path([CHORD]), color: '#ff0000' }]).issues.join(),
    ).toContain('metadata');
    expect(
      inspect([path([WAVY])], [path([line([...WAVY.points].reverse())])]).issues.join(),
    ).toContain('subsequence');
  });

  it('rejects a deviation only exposed by the actual non-uniform commit scale', () => {
    const small = line([
      { x: 0, y: 0 },
      { x: 1, y: 0.003 },
      { x: 2, y: 0 },
    ]);
    const saved = [path([CHORD], false)];
    expect(inspect([path([small])], saved).issues).toEqual([]);
    const result = traceCommitFidelity([path([small])], saved, {
      ...IDENTITY_TRANSFORM,
      scaleX: -0.1,
      scaleY: 10,
      rotationDeg: 30,
      mirrorY: true,
    });
    expect(result.maximumDeviationBoundMm).toBeCloseTo(0.03, 12);
    expect(result.issues.join()).toContain('deviation');
  });

  it('rejects a dropped hard corner even when the distance remains below tolerance', () => {
    const source = line([
      { x: 0, y: 0 },
      { x: 0.01, y: 0 },
      { x: 0.01, y: 0.01 },
    ]);
    const result = inspect(
      [path([source])],
      [path([line([source.points[0] as Vec2, source.points[2] as Vec2])])],
    );
    expect(result.maximumDeviationBoundMm).toBeLessThan(0.025);
    expect(result.issues.join()).toContain('lost hard corner');
  });

  it('rejects lost closure and collapsed closed marks', () => {
    const closed = line(
      [
        { x: 0, y: 0 },
        { x: 0.01, y: 0 },
        { x: 0, y: 0.01 },
        { x: 0, y: 0 },
      ],
      true,
    );
    expect(
      inspect([path([closed])], [path([{ ...closed, closed: false }])]).issues.join(),
    ).toContain('closure');
    expect(
      inspect(
        [path([closed])],
        [
          path([
            line(
              [closed.points[0] as Vec2, closed.points[1] as Vec2, closed.points[3] as Vec2],
              true,
            ),
          ]),
        ],
      ).issues.join(),
    ).toContain('collapsed');
  });

  it('keeps a fitted canonical curve exact while accepting its compiled compatibility chords', () => {
    const curve: CurveSubpath = {
      start: { x: 0, y: 0 },
      closed: false,
      segments: [
        { kind: 'cubic', control1: { x: 1, y: 2 }, control2: { x: 2, y: 2 }, to: { x: 3, y: 0 } },
      ],
    };
    const source = { ...path([CHORD]), curves: [curve] };
    const saved = { ...source, polylines: compilationPolylines(source, IDENTITY_TRANSFORM) };
    expect(inspect([source], [saved]).issues).toEqual([]);
    expect(inspect([source], [saved]).preservedNativeCurves).toBe(1);
    const corrupt: ColoredPath = { ...saved, curves: [{ ...curve, start: { x: 0.001, y: 0 } }] };
    expect(inspect([source], [corrupt]).issues.join()).toContain('fitted canonical curve changed');
    expect(inspect([source], [{ ...saved, polylines: [CHORD] }]).issues.join()).toContain(
      'compatibility',
    );
  });

  it('rejects new loop crossings even when every individual simplification is within tolerance', () => {
    const outer = circle(1);
    const inner = circle(0.99, Math.PI / 16);
    const reduce = (polyline: Polyline): Polyline => ({
      ...polyline,
      points: polyline.points.filter((_, index) => index % 8 === 0),
    });
    const result = inspect([path([outer, inner])], [path([reduce(outer), reduce(inner)], false)]);
    expect(result.maximumDeviationBoundMm).toBeLessThan(0.025);
    expect(result.topology.newIntersectingPairs).toBe(1);
    expect(result.issues.join()).toContain('Topology');
  });

  it('detects changed winding, containment and a newly self-intersecting loop', () => {
    const outer = circle(2);
    const inner = circle(0.5);
    const displaced = circle(0.5, 0, 4);
    expect(traceCommitTopology([outer, inner], [outer, displaced]).changedContainment).toBe(1);
    expect(
      traceCommitTopology([outer], [{ ...outer, points: [...outer.points].reverse() }])
        .changedWinding,
    ).toBe(1);
    const square = line(
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
        { x: 0, y: 0 },
      ],
      true,
    );
    const bowtie = line(
      [
        square.points[0] as Vec2,
        square.points[2] as Vec2,
        square.points[1] as Vec2,
        square.points[3] as Vec2,
        square.points[4] as Vec2,
      ],
      true,
    );
    expect(traceCommitTopology([square], [bowtie]).newSelfIntersections).toBe(1);
  });
});
