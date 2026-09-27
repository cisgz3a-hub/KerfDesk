import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg, type Transform, type Vec2 } from '../scene';
import { containedObjectIds, smallerObjectIds, worldClosedContours } from './shape-containment';

describe('select contained', () => {
  it('rejects edges crossing a concave notch even when every vertex is inside', () => {
    const cup = shape('cup', [
      [0, 0],
      [10, 0],
      [10, 10],
      [7, 10],
      [7, 3],
      [3, 3],
      [3, 10],
      [0, 10],
    ]);
    expect(
      containedObjectIds(worldClosedContours([cup]), [
        rect('bridge', 1, 7, 8, 1),
        rect('inside-arm', 1, 4, 1, 4),
        rect('touch-bottom', 1, 1, 8, 2),
      ]),
    ).toEqual(['inside-arm', 'touch-bottom']);
  });

  it('checks the closing edge and keeps separately contained paths separate', () => {
    const cup = shape('cup', [
      [0, 0],
      [10, 0],
      [10, 10],
      [7, 10],
      [7, 3],
      [3, 3],
      [3, 10],
      [0, 10],
    ]);
    const closure = shape('closure', [
      [1, 8],
      [1, 1],
      [9, 1],
      [9, 8],
    ]);
    const separate = {
      ...rect('separate', 1, 4, 1, 4),
      paths: [...rect('left', 1, 4, 1, 4).paths, ...rect('right', 8, 4, 1, 4).paths],
    };
    expect(containedObjectIds(worldClosedContours([cup]), [closure, separate])).toEqual([
      'separate',
    ]);
  });

  it('finds artwork lying fully inside a selected closed shape', () => {
    const contours = worldClosedContours([rect('frame', 0, 0, 100, 100)]);

    const found = containedObjectIds(contours, [
      rect('inside', 10, 10, 10, 10),
      rect('straddles', 90, 40, 20, 10),
      rect('outside', 200, 0, 10, 10),
    ]);

    expect(found).toEqual(['inside']);
  });

  it('follows the real outline of a concave container, not its bounding box', () => {
    const cup = shape('cup', [
      [0, 0],
      [30, 0],
      [30, 30],
      [20, 30],
      [20, 10],
      [10, 10],
      [10, 30],
      [0, 30],
    ]);
    const contours = worldClosedContours([cup]);

    const found = containedObjectIds(contours, [
      rect('in-the-notch', 12, 15, 6, 10),
      rect('in-the-wall', 2, 12, 6, 10),
    ]);

    expect(found).toEqual(['in-the-wall']);
  });

  it('works in world space, so moved and scaled artwork counts', () => {
    const scaled = rect('frame', 0, 0, 10, 10, { ...IDENTITY_TRANSFORM, x: 100, scaleX: 10 });
    const contours = worldClosedContours([scaled]);
    const moved = rect('moved', 0, 0, 5, 5, { ...IDENTITY_TRANSFORM, x: 150, y: 2 });

    expect(containedObjectIds(contours, [moved, rect('local', 0, 0, 5, 5)])).toEqual(['moved']);
  });

  it('does not count a shape that straddles two containers', () => {
    const contours = worldClosedContours([
      rect('left', 0, 0, 50, 50),
      rect('right', 50, 0, 50, 50),
    ]);

    expect(containedObjectIds(contours, [rect('bridge', 40, 10, 20, 10)])).toEqual([]);
  });

  it('ignores open paths as containers', () => {
    const open: ImportedSvg = {
      ...rect('open', 0, 0, 100, 100),
      paths: [
        {
          color: '#000000',
          polylines: [{ closed: false, points: [p(0, 0), p(100, 0), p(100, 100), p(0, 100)] }],
        },
      ],
    };

    expect(worldClosedContours([open])).toEqual([]);
  });
});

describe('select smaller shapes', () => {
  it('finds artwork no wider and no taller than the selection', () => {
    const found = smallerObjectIds(
      [rect('reference', 0, 0, 10, 10)],
      [
        rect('smaller', 50, 50, 5, 5),
        rect('same', 70, 0, 10, 10),
        rect('too-wide', 0, 50, 12, 5),
        rect('too-tall', 0, 80, 5, 12),
      ],
    );

    expect(found).toEqual(['smaller', 'same']);
  });

  it('measures rotated artwork by its world size', () => {
    const turned = rect('turned', 0, 0, 12, 5, { ...IDENTITY_TRANSFORM, rotationDeg: 90 });

    expect(smallerObjectIds([rect('reference', 0, 0, 6, 12)], [turned])).toEqual(['turned']);
    expect(smallerObjectIds([rect('reference', 0, 0, 12, 6)], [turned])).toEqual([]);
  });

  it('uses the widest and tallest of several selected objects', () => {
    const references = [rect('wide', 0, 0, 20, 2), rect('tall', 0, 0, 2, 20)];

    expect(smallerObjectIds(references, [rect('square', 0, 0, 15, 15)])).toEqual(['square']);
  });
});

function p(x: number, y: number): Vec2 {
  return { x, y };
}

function rect(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  transform: Transform = IDENTITY_TRANSFORM,
): ImportedSvg {
  return {
    ...shape(id, [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
    ]),
    transform,
  };
}

function shape(id: string, corners: ReadonlyArray<readonly [number, number]>): ImportedSvg {
  const points = corners.map(([x, y]) => p(x, y));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [{ closed: true, points }] }],
  };
}
