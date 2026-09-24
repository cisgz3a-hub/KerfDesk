import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import {
  comparableContour,
  contoursMatch,
  createContourIndex,
  type ComparableContour,
} from './duplicate-contours';

const SQUARE: ReadonlyArray<Vec2> = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

function contour(points: ReadonlyArray<Vec2>, closed = true): ComparableContour {
  const result = comparableContour(points, closed);
  if (result === null) throw new Error('expected a comparable contour');
  return result;
}

function shifted(points: ReadonlyArray<Vec2>, dx: number, dy = 0): ReadonlyArray<Vec2> {
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

describe('contoursMatch (Delete Duplicates, ADR-377)', () => {
  it('matches an exact copy and a copy with its closing point repeated', () => {
    const square = contour(SQUARE);

    expect(contoursMatch(square, contour(SQUARE))).toBe(true);
    expect(contoursMatch(square, contour([...SQUARE, { x: 0, y: 0 }]))).toBe(true);
  });

  it('matches a closed copy that runs the other way or starts at another corner', () => {
    const square = contour(SQUARE);

    expect(contoursMatch(square, contour([...SQUARE].reverse()))).toBe(true);
    expect(contoursMatch(square, contour([...SQUARE.slice(2), ...SQUARE.slice(0, 2)]))).toBe(true);
    const reversedFromCorner = [...SQUARE.slice(1), ...SQUARE.slice(0, 1)].reverse();
    expect(contoursMatch(square, contour(reversedFromCorner))).toBe(true);
  });

  it('matches within the 0.01 mm tolerance and keeps a copy just outside it', () => {
    const square = contour(SQUARE);

    expect(contoursMatch(square, contour(shifted(SQUARE, 0.006, -0.004)))).toBe(true);
    expect(contoursMatch(square, contour(shifted(SQUARE, 0.03)))).toBe(false);
  });

  it('matches a copy with an extra point along one side', () => {
    const withMidpoint = [SQUARE[0], { x: 5, y: 0 }, ...SQUARE.slice(1)] as ReadonlyArray<Vec2>;

    expect(contoursMatch(contour(SQUARE), contour(withMidpoint))).toBe(true);
  });

  it('keeps shapes that share corners but not sides', () => {
    const bowTie = [SQUARE[0], SQUARE[2], SQUARE[1], SQUARE[3]] as ReadonlyArray<Vec2>;
    const bulged = [SQUARE[0], { x: 5, y: -0.5 }, ...SQUARE.slice(1)] as ReadonlyArray<Vec2>;

    expect(contoursMatch(contour(SQUARE), contour(bowTie))).toBe(false);
    expect(contoursMatch(contour(SQUARE), contour(bulged))).toBe(false);
  });

  it('matches an open line drawn backwards but not one that doubles back', () => {
    const line = contour(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
      ],
      false,
    );
    const backwards = contour(
      [
        { x: 10, y: 5 },
        { x: 10, y: 0 },
        { x: 0, y: 0 },
      ],
      false,
    );
    const doubledBack = contour(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
        { x: 10, y: 0 },
      ],
      false,
    );

    expect(contoursMatch(line, backwards)).toBe(true);
    expect(contoursMatch(line, doubledBack)).toBe(false);
    expect(contoursMatch(line, contour(SQUARE))).toBe(false);
  });

  it('treats an open contour that returns to its start as the closed loop', () => {
    const loop = contour([...SQUARE, { x: 0, y: 0 }], false);

    expect(loop.closed).toBe(true);
    expect(contoursMatch(loop, contour([...SQUARE].reverse()))).toBe(true);
  });

  it('refuses contours with no length', () => {
    expect(
      comparableContour(
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
        false,
      ),
    ).toBeNull();
  });
});

describe('createContourIndex', () => {
  it('finds a copy across a lookup-cell edge but only under the same output key', () => {
    const index = createContourIndex();
    const near = shifted(SQUARE, 0.998, 0.998);
    index.add('cut', contour(near));

    expect(index.hasMatch('cut', contour(shifted(near, 0.005, 0.005)))).toBe(true);
    expect(index.hasMatch('score', contour(near))).toBe(false);
    expect(index.hasMatch('cut', contour(shifted(near, 1)))).toBe(false);
  });
});
