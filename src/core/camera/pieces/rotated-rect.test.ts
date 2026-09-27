import { describe, expect, it } from 'vitest';
import { convexHull, halfTurn, minAreaRect, snugRect, type Point } from './rotated-rect';

function rectCorners(cx: number, cy: number, length: number, width: number, deg: number): Point[] {
  const rad = (deg * Math.PI) / 180;
  const u = { x: Math.cos(rad), y: Math.sin(rad) };
  const v = { x: -Math.sin(rad), y: Math.cos(rad) };
  return [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ].map(([a = 0, b = 0]) => ({
    x: cx + (a * length * u.x) / 2 + (b * width * v.x) / 2,
    y: cy + (a * length * u.y) / 2 + (b * width * v.y) / 2,
  }));
}

describe('convexHull', () => {
  it('drops interior and collinear points', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 4, y: 6 },
    ]);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual({ x: 5, y: 0 });
  });
});

describe('minAreaRect', () => {
  it.each([0, 17, 45, 90, 133, 179])('recovers a %d° rectangle', (deg) => {
    const corners = rectCorners(120, 80, 60, 25, deg);
    const inner = [
      { x: 120, y: 80 },
      { x: 125, y: 82 },
    ];
    const rect = minAreaRect([...corners, ...inner]);
    expect(rect).not.toBeNull();
    expect(rect?.centre.x).toBeCloseTo(120, 6);
    expect(rect?.centre.y).toBeCloseTo(80, 6);
    expect(rect?.length).toBeCloseTo(60, 6);
    expect(rect?.width).toBeCloseTo(25, 6);
    // 179° and -1° are the same axis.
    const axis = rect?.axisDeg ?? NaN;
    expect(
      Math.min(Math.abs(axis - halfTurn(deg)), 180 - Math.abs(axis - halfTurn(deg))),
    ).toBeLessThan(1e-6);
  });

  it('has no rectangle for fewer than three distinct points', () => {
    expect(
      minAreaRect([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBeNull();
  });
});

describe('halfTurn', () => {
  it('folds angles into [0, 180)', () => {
    expect(halfTurn(-30)).toBeCloseTo(150);
    expect(halfTurn(180)).toBe(0);
    expect(halfTurn(365)).toBeCloseTo(5);
  });
});

describe('snugRect', () => {
  it('moves straight sides in to the median of noisy edge points', () => {
    const points: Point[] = [];
    for (let i = 0; i <= 80; i += 1) {
      const wobble = (i % 5) * 0.2 - 0.4;
      points.push({ x: i, y: 0 + wobble }, { x: i, y: 40 + wobble });
    }
    for (let j = 0; j <= 40; j += 1) {
      const wobble = (j % 5) * 0.2 - 0.4;
      points.push({ x: 0 + wobble, y: j }, { x: 80 + wobble, y: j });
    }
    const rough = minAreaRect(points);
    expect(rough?.length).toBeCloseTo(80.8);
    const snug = rough === null ? null : snugRect(rough, points);
    expect(snug?.length).toBeCloseTo(80, 6);
    expect(snug?.width).toBeCloseTo(40, 6);
    expect(snug?.centre.x).toBeCloseTo(40, 6);
  });

  it('leaves a disc as its smallest square', () => {
    const points = Array.from({ length: 360 }, (_, i) => ({
      x: 50 + 30 * Math.cos((i * Math.PI) / 180),
      y: 50 + 30 * Math.sin((i * Math.PI) / 180),
    }));
    const rough = minAreaRect(points);
    const snug = rough === null ? null : snugRect(rough, points);
    expect(snug?.length).toBeCloseTo(rough?.length ?? NaN, 9);
    expect(snug?.width).toBeCloseTo(rough?.width ?? NaN, 9);
  });
});
