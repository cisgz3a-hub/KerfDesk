import { describe, expect, it } from 'vitest';
import { curveSubpathBounds, type Bounds, type ColoredPath } from '../scene';
import { coloredPathsBounds } from './colored-paths-bounds';

// boundsForPaths as text-bend.ts and text-on-path.ts had it before ADR-691:
// every value spread into one Math.min / Math.max call. The loop must give the
// same box for every input this can still take, including the edge cases.
function spreadBounds(paths: ReadonlyArray<ColoredPath>): Bounds {
  const curves = paths.flatMap((path) => path.curves?.map(curveSubpathBounds) ?? []);
  const points = paths.flatMap((path) => path.polylines.flatMap((line) => line.points));
  const xs = [
    ...curves.flatMap((bounds) => [bounds.minX, bounds.maxX]),
    ...points.map((point) => point.x),
  ];
  const ys = [
    ...curves.flatMap((bounds) => [bounds.minY, bounds.maxY]),
    ...points.map((point) => point.y),
  ];
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function expectSameBox(actual: Bounds, expected: Bounds): void {
  for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const) {
    // Object.is tells -0 from 0 and matches NaN to NaN, as toEqual would not.
    expect(Object.is(actual[key], expected[key]), key).toBe(true);
  }
}

const MIXED: ReadonlyArray<ColoredPath> = [
  {
    color: '#000000',
    polylines: [
      {
        closed: false,
        points: [
          { x: 3, y: -2 },
          { x: -0, y: 7.5 },
        ],
      },
    ],
    curves: [
      {
        start: { x: 1, y: 1 },
        segments: [
          {
            kind: 'cubic',
            control1: { x: 1, y: 12 },
            control2: { x: 9, y: 12 },
            to: { x: 9, y: 1 },
          },
          { kind: 'line', to: { x: 12, y: -4 } },
        ],
        closed: false,
      },
    ],
  },
  { color: '#ff0000', polylines: [{ closed: true, points: [{ x: -6, y: 0 }] }] },
];

describe('coloredPathsBounds', () => {
  it('gives the box the spread gave for curves and polylines together', () => {
    expectSameBox(coloredPathsBounds(MIXED), spreadBounds(MIXED));
    expect(coloredPathsBounds(MIXED)).toMatchObject({ minX: -6, minY: -4, maxX: 12 });
  });

  // An empty text has no ink: the spread of an empty array gave Math.min() =
  // Infinity and Math.max() = -Infinity, and the loop starts from those values.
  it('keeps Infinity and -Infinity for no paths and for paths with no points', () => {
    const empty = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const paths of [[], [{ color: '#000000', polylines: [] }]] as ColoredPath[][]) {
      expectSameBox(coloredPathsBounds(paths), empty);
      expectSameBox(coloredPathsBounds(paths), spreadBounds(paths));
    }
  });

  it('carries a NaN coordinate through to that axis, as the spread did', () => {
    const paths: ReadonlyArray<ColoredPath> = [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 1, y: 2 },
              { x: Number.NaN, y: 4 },
            ],
          },
        ],
      },
    ];
    const box = coloredPathsBounds(paths);
    expectSameBox(box, spreadBounds(paths));
    expect(box).toMatchObject({ minY: 2, maxY: 4 });
    expect(box.minX).toBeNaN();
  });

  it('keeps -0 as the minimum and +0 as the maximum when both appear', () => {
    const paths: ReadonlyArray<ColoredPath> = [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: -0 },
              { x: -0, y: 0 },
            ],
          },
        ],
      },
    ];
    expectSameBox(coloredPathsBounds(paths), spreadBounds(paths));
  });

  // Audit S7-P2-3: 450 characters of Great Vibes is about 236,000 points, and
  // the spread threw "Maximum call stack size exceeded" from about 120,000.
  it('takes more points than a call can take as arguments', () => {
    const count = 500_000;
    const points = Array.from({ length: count }, (_, index) => ({
      x: index - 1000,
      y: (index % 7) - 3,
    }));
    const paths: ReadonlyArray<ColoredPath> = [
      { color: '#000000', polylines: [{ closed: false, points }] },
    ];
    expect(() => spreadBounds(paths)).toThrow(RangeError);
    expect(coloredPathsBounds(paths)).toEqual({
      minX: -1000,
      minY: -3,
      maxX: count - 1001,
      maxY: 3,
    });
  });
});
