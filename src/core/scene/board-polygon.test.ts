import { describe, expect, it } from 'vitest';
import { boardPolygonFromPoints, boardPolygonWithPoint, polygonSelfIntersects } from './board-polygon';

const FRONT_LEFT = { x: 1, y: 1 } as const;
const REAR_LEFT = { x: 1, y: -1 } as const;

// A house-shaped board (pentagon) captured walking around it from the
// front-left corner, in machine coordinates on a front-left-origin machine.
const HOUSE = [
  { x: 100, y: 50 },
  { x: 200, y: 50 },
  { x: 200, y: 120 },
  { x: 150, y: 160 },
  { x: 100, y: 120 },
];

describe('boardPolygonFromPoints', () => {
  it('measures the outline and puts the origin at its physical front-left', () => {
    const result = boardPolygonFromPoints(HOUSE, FRONT_LEFT);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const { polygon } = result;
    expect(polygon.origin).toEqual({ x: 100, y: 50 });
    expect(polygon.widthMm).toBe(100);
    expect(polygon.heightMm).toBe(110);
    expect(polygon.areaMm2).toBe(100 * 70 + (100 * 40) / 2);
    expect(polygon.reordered).toBe(false);
  });

  it('draws the outline in canvas space with the back edge at the top', () => {
    const result = boardPolygonFromPoints(HOUSE, FRONT_LEFT);
    if (result.kind !== 'ok') throw new Error('expected a polygon');
    // Front-left corner sits at canvas (0, height); the roof apex at the top.
    expect(result.polygon.outline[0]).toEqual({ x: 0, y: 110 });
    expect(result.polygon.outline[3]).toEqual({ x: 50, y: 0 });
  });

  it('keeps the physical shape on a rear-origin machine (machine +Y toward the operator)', () => {
    // The same house, but machine Y grows toward the operator.
    const mirrored = HOUSE.map((p) => ({ x: p.x, y: -p.y }));
    const result = boardPolygonFromPoints(mirrored, REAR_LEFT);
    if (result.kind !== 'ok') throw new Error('expected a polygon');
    // Front-left = largest machine Y on a rear origin.
    expect(result.polygon.origin).toEqual({ x: 100, y: -50 });
    expect(result.polygon.outline[3]).toEqual({ x: 50, y: 0 });
    expect(result.polygon.outline[0]).toEqual({ x: 0, y: 110 });
  });

  it('re-sorts corners captured out of order when that gives a simple outline', () => {
    // Square captured as a bow-tie: BL, TR, BR, TL.
    const bowTie = [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 50, y: 0 },
      { x: 0, y: 50 },
    ];
    expect(polygonSelfIntersects(bowTie)).toBe(true);
    const result = boardPolygonFromPoints(bowTie, FRONT_LEFT);
    if (result.kind !== 'ok') throw new Error('expected a polygon');
    expect(result.polygon.reordered).toBe(true);
    expect(result.polygon.points[0]).toEqual({ x: 0, y: 0 });
    expect(polygonSelfIntersects(result.polygon.points)).toBe(false);
    expect(result.polygon.areaMm2).toBe(2500);
  });

  it('refuses fewer than three corners and corners in a line', () => {
    expect(boardPolygonFromPoints(HOUSE.slice(0, 2), FRONT_LEFT)).toEqual({
      kind: 'error',
      issue: 'too-few-points',
    });
    expect(
      boardPolygonFromPoints(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
        ],
        FRONT_LEFT,
      ),
    ).toEqual({ kind: 'error', issue: 'too-thin' });
  });

  it('refuses non-finite corners', () => {
    expect(boardPolygonFromPoints([...HOUSE, { x: Number.NaN, y: 0 }], FRONT_LEFT)).toEqual({
      kind: 'error',
      issue: 'not-finite',
    });
  });
});

describe('boardPolygonWithPoint', () => {
  it('moves one corner and recomputes the origin', () => {
    const result = boardPolygonFromPoints(HOUSE, FRONT_LEFT);
    if (result.kind !== 'ok') throw new Error('expected a polygon');
    const moved = boardPolygonWithPoint(result.polygon, 0, { x: 95, y: 48 }, FRONT_LEFT);
    expect(moved?.origin).toEqual({ x: 95, y: 48 });
    expect(moved?.widthMm).toBe(105);
  });

  it('refuses a correction that makes the outline cross itself', () => {
    const result = boardPolygonFromPoints(HOUSE, FRONT_LEFT);
    if (result.kind !== 'ok') throw new Error('expected a polygon');
    expect(boardPolygonWithPoint(result.polygon, 3, { x: 150, y: 10 }, FRONT_LEFT)).toBeNull();
  });
});
