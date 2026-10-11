import { describe, expect, it } from 'vitest';
import { ciBudgetMs } from '../../__fixtures__/ci-budget';
import { segmentContainedInPolygon } from '../geometry/segment-contained-in-polygon';
import type { Vec2 } from '../scene';
import { ContourBoxIndex } from '../trace/contour-box-index';
import { properContourAncestors } from './proper-contour-containment';
import { boundsContains, polylineBounds } from './segment-bounds';

type Contour = {
  readonly polyline: ReadonlyArray<Vec2>;
  readonly closed: boolean;
  readonly nesting?: { readonly forest: string; readonly depth: number };
};

// The all-pairs implementation this module replaced, kept verbatim as the
// reference the indexed path must match exactly.
function referenceAncestors(contours: ReadonlyArray<Contour>): number[][] {
  const inside = (target: ReadonlyArray<Vec2>, container: ReadonlyArray<Vec2>): boolean =>
    target.length >= 3 &&
    target.every((from, index) => {
      const to = target[(index + 1) % target.length];
      return to !== undefined && segmentContainedInPolygon(from, to, container);
    });
  const boxes = contours.flatMap((contour, index) => {
    const box = contour.closed ? polylineBounds(contour.polyline) : null;
    return box === null ? [] : [{ ...box, index }];
  });
  const spatial = ContourBoxIndex.create(boxes);
  return contours.map((target, index) => {
    const box = polylineBounds(target.polyline);
    if (box === null) return [];
    return spatial
      .query(box)
      .filter((candidate) => {
        if (candidate.index === index || !boundsContains(candidate, box)) return false;
        const container = contours[candidate.index];
        if (
          container === undefined ||
          (target.nesting !== undefined && target.nesting.forest === container.nesting?.forest)
        )
          return false;
        if (!inside(target.polyline, container.polyline)) return false;
        return !boundsContains(box, candidate) || !inside(container.polyline, target.polyline);
      })
      .map((candidate) => candidate.index)
      .sort((a, b) => a - b);
  });
}

function ring(
  radius: number,
  vertices: number,
  phase = 0,
  cx = 200,
  cy = 200,
  amplitude = 1,
): Vec2[] {
  return Array.from({ length: vertices }, (_, v) => {
    const a = (v / vertices) * Math.PI * 2;
    const wobble =
      1 + amplitude * (0.04 * Math.sin(a * 7 + phase) + 0.02 * Math.sin(a * 23 + phase * 3));
    return { x: cx + radius * wobble * Math.cos(a), y: cy + radius * wobble * Math.sin(a) };
  });
}

function square(minX: number, minY: number, size: number, steps: number): Vec2[] {
  const points: Vec2[] = [];
  const corners = [
    { x: minX, y: minY },
    { x: minX + size, y: minY },
    { x: minX + size, y: minY + size },
    { x: minX, y: minY + size },
  ];
  corners.forEach((from, side) => {
    const to = corners[(side + 1) % 4] as Vec2;
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      points.push({ x: from.x + t * (to.x - from.x), y: from.y + t * (to.y - from.y) });
    }
  });
  return points;
}

const closed = (polyline: ReadonlyArray<Vec2>): Contour => ({ polyline, closed: true });

describe('properContourAncestors', () => {
  it('matches the all-pairs reference on nested topographic rings', () => {
    const contours = Array.from({ length: 14 }, (_, r) => closed(ring(180 - r * 12, 240, r)));
    const ancestors = properContourAncestors(contours);
    expect(ancestors).toEqual(referenceAncestors(contours));
    expect(ancestors[13]).toHaveLength(13);
  });

  it('matches the reference where outlines touch, share edges, cross or coincide', () => {
    const outer = square(0, 0, 100, 60);
    const contours: Contour[] = [
      closed(outer),
      // Shares the outer square's left edge, so the exact boundary test decides.
      closed(square(0, 20, 40, 40)),
      // Touches the outer square from inside at one corner.
      closed(square(60, 60, 40, 40)),
      // Identical to the outer square: mutual containment is not proper.
      closed([...outer]),
      // Crosses the outer square's right edge.
      closed(square(80, 40, 40, 30)),
      // Wholly inside, clear of every boundary.
      closed(square(45, 5, 10, 30)),
      // An open polyline target inside the outer square.
      { polyline: square(10, 70, 15, 20).slice(0, 30), closed: false },
      // Repeats its first point to close.
      closed([...square(5, 5, 30, 30), { x: 5, y: 5 }]),
    ];
    expect(properContourAncestors(contours)).toEqual(referenceAncestors(contours));
  });

  it('matches the reference across randomised nested and overlapping rings', () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const contours = Array.from({ length: 24 }, (_, i) =>
      closed(
        ring(
          20 + random() * 150,
          80 + Math.floor(random() * 120),
          i,
          150 + random() * 100,
          150 + random() * 100,
        ),
      ),
    );
    expect(properContourAncestors(contours)).toEqual(referenceAncestors(contours));
  });

  it('keeps contours of one nesting forest out of each other', () => {
    const contours: Contour[] = Array.from({ length: 6 }, (_, r) => ({
      polyline: ring(150 - r * 20, 200, r),
      closed: true,
      nesting: { forest: r % 2 === 0 ? 'a' : 'b', depth: 0 },
    }));
    const ancestors = properContourAncestors(contours);
    expect(ancestors).toEqual(referenceAncestors(contours));
    expect(ancestors[5]).toEqual([0, 2, 4]);
  });

  it('keeps the exact path for non-finite coordinates', () => {
    const contours = [
      closed(ring(150, 400, 0)),
      closed([...ring(50, 400, 1), { x: Number.NaN, y: 200 }]),
    ];
    expect(properContourAncestors(contours)).toEqual(referenceAncestors(contours));
  });

  it('classifies a 60-ring topographic design in near-linear time', () => {
    // Gentle wobble keeps the rings 2.8 mm apart and strictly nested.
    const contours = Array.from({ length: 60 }, (_, r) =>
      closed(ring(180 - r * 2.8, 500, r, 200, 200, 0.1)),
    );
    const started = performance.now();
    const ancestors = properContourAncestors(contours);
    const elapsed = performance.now() - started;
    expect(ancestors.map((list) => list.length)).toEqual(contours.map((_, r) => r));
    // The all-pairs scan took about a minute here.
    expect(elapsed).toBeLessThan(ciBudgetMs(1_500, 5_000));
  });
});
