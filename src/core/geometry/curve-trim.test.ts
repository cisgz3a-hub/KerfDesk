import { describe, expect, it } from 'vitest';
import type { CurveSubpath, Vec2 } from '../scene';
import { trimCurveSubpath, type TrimCutter } from './curve-trim';

const identity = (point: Vec2): Vec2 => point;

const LINE: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [{ kind: 'line', to: { x: 30, y: 0 } }],
  closed: false,
};

const SQUARE: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'line', to: { x: 10, y: 0 } },
    { kind: 'line', to: { x: 10, y: 10 } },
    { kind: 'line', to: { x: 0, y: 10 } },
  ],
  closed: true,
};

const POSTS: ReadonlyArray<TrimCutter> = [
  [
    { x: 10, y: -5 },
    { x: 10, y: 5 },
  ],
  [
    { x: 20, y: -5 },
    { x: 20, y: 5 },
  ],
];

function nodes(path: CurveSubpath | undefined): ReadonlyArray<Vec2> {
  if (path === undefined) return [];
  return [path.start, ...path.segments.map((segment) => segment.to)];
}

function expectNodes(path: CurveSubpath | undefined, expected: ReadonlyArray<Vec2>): void {
  const actual = nodes(path);
  expect(actual).toHaveLength(expected.length);
  actual.forEach((point, index) => {
    expect(point.x).toBeCloseTo(expected[index]!.x, 6);
    expect(point.y).toBeCloseTo(expected[index]!.y, 6);
  });
}

function trim(
  path: CurveSubpath,
  segmentIndex: number,
  t: number,
  cutters: ReadonlyArray<TrimCutter>,
  toShared = identity,
) {
  return trimCurveSubpath({
    path,
    cursor: { segmentIndex, t },
    toShared,
    cutters,
    tolerance: 0.01,
  });
}

describe('curve trim', () => {
  it('cuts the stretch under the cursor back to the crossings on both sides', () => {
    const result = trim(LINE, 0, 0.5, POSTS);
    if (result.kind !== 'trimmed') throw new Error('expected a trim');
    expect(result.pieces).toHaveLength(2);
    expectNodes(result.pieces[0], [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expectNodes(result.pieces[1], [
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it('trims an overshooting end back to its last crossing', () => {
    const result = trim(LINE, 0, 25 / 30, POSTS);
    if (result.kind !== 'trimmed') throw new Error('expected a trim');
    expect(result.pieces).toHaveLength(1);
    expectNodes(result.pieces[0], [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
  });

  it('leaves a path that crosses nothing alone', () => {
    expect(trim(LINE, 0, 0.5, [])).toEqual({ kind: 'no-crossing' });
    expect(trim(SQUARE, 0, 0.5, [])).toEqual({ kind: 'no-crossing' });
  });

  it('cuts a closed path between two crossings and opens it there', () => {
    const bar: TrimCutter = [
      { x: -5, y: 5 },
      { x: 15, y: 5 },
    ];
    const result = trim(SQUARE, 0, 0.5, [bar]);
    if (result.kind !== 'trimmed') throw new Error('expected a trim');
    expect(result.pieces).toHaveLength(1);
    expect(result.pieces[0]?.closed).toBe(false);
    expectNodes(result.pieces[0], [
      { x: 10, y: 5 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 5 },
    ]);
  });

  it('wraps past the seam of a closed path to find the crossing', () => {
    const bar: TrimCutter = [
      { x: 5, y: -5 },
      { x: 5, y: 15 },
    ];
    // Cursor on the closing edge (0,10) -> (0,0): the stretch runs from the
    // bottom crossing (5,10) round the seam to the top crossing (5,0).
    const result = trim(SQUARE, 3, 0.5, [bar]);
    if (result.kind !== 'trimmed') throw new Error('expected a trim');
    expectNodes(result.pieces[0], [
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 5, y: 10 },
    ]);
  });

  it('stops at crossings with the path itself', () => {
    const bowtie: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', to: { x: 10, y: 10 } },
        { kind: 'line', to: { x: 10, y: 0 } },
        { kind: 'line', to: { x: 0, y: 10 } },
      ],
      closed: false,
    };
    const result = trim(bowtie, 0, 0.2, []);
    if (result.kind !== 'trimmed') throw new Error('expected a trim');
    expectNodes(result.pieces[0], [
      { x: 5, y: 5 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ]);
  });

  it('does not count the shared node of neighbouring segments as a crossing', () => {
    const bend: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', to: { x: 10, y: 0 } },
        { kind: 'line', to: { x: 10, y: 0 } },
        { kind: 'line', to: { x: 10, y: 10 } },
      ],
      closed: false,
    };
    expect(trim(bend, 0, 0.5, [])).toEqual({ kind: 'no-crossing' });
  });

  it('finds crossings in the shared space and cuts the stored curve there', () => {
    // The artwork is drawn at double size; the post at x = 20 on the bed
    // crosses the stored line at x = 10.
    const doubled = (point: Vec2): Vec2 => ({ x: point.x * 2, y: point.y * 2 });
    const post: TrimCutter = [
      { x: 20, y: -5 },
      { x: 20, y: 5 },
    ];
    const result = trim(LINE, 0, 0.1, [post], doubled);
    if (result.kind !== 'trimmed') throw new Error('expected a trim');
    expectNodes(result.pieces[0], [
      { x: 10, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it('cuts a curve exactly where it crosses', () => {
    const hump: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        {
          kind: 'cubic',
          control1: { x: 0, y: 20 },
          control2: { x: 20, y: 20 },
          to: { x: 20, y: 0 },
        },
      ],
      closed: false,
    };
    const shelf: TrimCutter = [
      { x: -5, y: 10 },
      { x: 25, y: 10 },
    ];
    const result = trim(hump, 0, 0.5, [shelf]);
    if (result.kind !== 'trimmed') throw new Error('expected a trim');
    expect(result.pieces).toHaveLength(2);
    // Both cut ends sit on the shelf line.
    expect(result.pieces[0]?.segments.at(-1)?.to.y).toBeCloseTo(10, 2);
    expect(result.pieces[1]?.start.y).toBeCloseTo(10, 2);
    expect(result.pieces[0]?.segments[0]?.kind).toBe('cubic');
  });
});
