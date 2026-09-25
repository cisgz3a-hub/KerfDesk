import { describe, expect, it } from 'vitest';
import type { ColoredPath, CurveSubpath, Polyline } from '../scene';
import { groupSubpathsByOuterShape } from './outer-shape-groups';

describe('groupSubpathsByOuterShape', () => {
  it('keeps each hole with its outer and makes an island inside a hole its own shape', () => {
    // Order is deliberately scrambled: grouping must come from containment.
    const path = polylinePath([
      square(40, 40, 2), // 0: island's hole (depth 3)
      square(0, 0, 100), // 1: outer (depth 0)
      square(30, 30, 20), // 2: island (depth 2)
      square(10, 10, 60), // 3: hole of the outer (depth 1)
      square(200, 0, 5), // 4: separate speck (depth 0)
    ]);

    expect(groupSubpathsByOuterShape(path)).toEqual([[0, 2], [1, 3], [4]]);
  });

  it('assigns a hole to its nearest outer when outers sit side by side', () => {
    const path = polylinePath([
      square(0, 0, 10),
      square(20, 0, 10),
      square(22, 2, 6),
      square(2, 2, 6),
    ]);

    expect(groupSubpathsByOuterShape(path)).toEqual([
      [0, 3],
      [1, 2],
    ]);
  });

  it('keeps a hole that touches its outer at a corner with that outer', () => {
    // A pixel-grid trace can close a hole against its outer at one vertex.
    const hole: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 2 },
        { x: 2, y: 5 },
      ],
    };
    const path = polylinePath([square(0, 0, 10), hole]);

    expect(groupSubpathsByOuterShape(path)).toEqual([[0, 1]]);
  });

  it('keeps a hole whose every vertex lies on its outer with that outer', () => {
    // Each vertex probe abstains for the outer; the vote must not fall
    // through to "no container" and make the hole a solid shape.
    const diamond: Polyline = {
      closed: true,
      points: [
        { x: 1, y: 0 },
        { x: 2, y: 1 },
        { x: 1, y: 2 },
        { x: 0, y: 1 },
      ],
    };
    expect(groupSubpathsByOuterShape(polylinePath([square(0, 0, 2), diamond]))).toEqual([[0, 1]]);
    // A diamond island inside that hole still starts its own shape.
    const island: Polyline = {
      closed: true,
      points: [
        { x: 1, y: 0.5 },
        { x: 1.5, y: 1 },
        { x: 1, y: 1.5 },
        { x: 0.5, y: 1 },
      ],
    };
    expect(groupSubpathsByOuterShape(polylinePath([square(0, 0, 2), diamond, island]))).toEqual([
      [0, 1],
      [2],
    ]);
  });

  it('follows nonzero winding: a same-direction inner loop is filled, not a hole', () => {
    const outer = square(0, 0, 100);
    const sameDirection = square(10, 10, 60);
    const island = square(30, 30, 20);
    const path: ColoredPath = {
      ...polylinePath([outer, sameDirection, island]),
      fillRule: 'nonzero',
    };
    // Winding inside the inner loop is 2, so it and the island stay one shape.
    expect(groupSubpathsByOuterShape(path)).toEqual([[0, 1, 2]]);

    const hole = reversed(sameDirection);
    const holed: ColoredPath = { ...polylinePath([outer, hole, island]), fillRule: 'nonzero' };
    expect(groupSubpathsByOuterShape(holed)).toEqual([[0, 1], [2]]);
    // Even-odd ignores direction.
    expect(groupSubpathsByOuterShape(polylinePath([outer, sameDirection, island]))).toEqual([
      [0, 1],
      [2],
    ]);
  });

  it('uses canonical curves and leaves open subpaths as their own shapes', () => {
    const open: CurveSubpath = {
      start: { x: 3, y: 3 },
      closed: false,
      segments: [{ kind: 'line', to: { x: 5, y: 5 } }],
    };
    const path: ColoredPath = {
      color: '#000000',
      curves: [circle(10, 10, 8), open, circle(10, 10, 3)],
      // Deliberately misaligned compatibility view: grouping must flatten curves.
      polylines: [],
    };

    expect(groupSubpathsByOuterShape(path)).toEqual([[0, 2], [1]]);
  });
});

function polylinePath(polylines: ReadonlyArray<Polyline>): ColoredPath {
  return { color: '#000000', polylines };
}

function reversed(polyline: Polyline): Polyline {
  return { ...polyline, points: [...polyline.points].reverse() };
}

function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

// Four-cubic circle approximation.
function circle(cx: number, cy: number, r: number): CurveSubpath {
  const k = 0.5523 * r;
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
