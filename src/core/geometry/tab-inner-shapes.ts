// "Skip inner shapes" for automatic tabs: a closed shape takes tabs only when it
// lies strictly inside an even number of the layer's other closed shapes, so
// parts take tabs and their holes do not. Testing every shape against every
// other took about 20 s for a sheet of 3000 parts. A shape can only lie inside
// one whose box holds its box, so a box index finds those few candidates and
// the exact test decides each of them: the same result as testing every pair
// (ADR-494 Amendment 1).

import type { Vec2 } from '../scene';
import { ContourBoxIndex } from '../trace/contour-box-index';
import type { ContourBox } from '../trace/contour-bounds';
import { strictlyContains } from './tab-contour-containment';

type ShapeBox = ContourBox & { readonly index: number };

// The exact test's even-odd crossing count puts every vertex of a shape inside
// a container within the container's box, give or take the rounding of one
// crossing (about 1e-15 of the largest coordinate). Boxes grow by far more than
// that, so the box test never drops a pair the exact test would accept.
const BOX_ALLOWANCE = 1e-9;
// Beyond this size that rounding bound no longer holds, and a point that is not
// a number has no box: such layers test every pair, as before.
const LARGEST_INDEXED_COORDINATE = 1e150;

/** For each shape, given as its closed points or as null when it cannot hold
 * tabs (an open path, or fewer than three distinct points): whether it lies
 * strictly inside an even number of the other shapes. */
export function evenlyNestedShapes(
  shapes: ReadonlyArray<ReadonlyArray<Vec2> | null>,
): ReadonlyArray<boolean> {
  const boxes = shapes.map((points, index) =>
    points === null ? null : { ...boxOf(points), index },
  );
  const scale = largestCoordinate(boxes);
  const candidatesFor =
    scale <= LARGEST_INDEXED_COORDINATE
      ? indexedCandidates(boxes, BOX_ALLOWANCE * Math.max(1, scale))
      : everyShape(boxes);
  return shapes.map((points, index) => {
    const box = boxes[index];
    if (points === null || box === null || box === undefined) return false;
    let depth = 0;
    for (const candidate of candidatesFor(box)) {
      const container = shapes[candidate];
      if (candidate === index || container === null || container === undefined) continue;
      if (strictlyContains(container, points)) depth += 1;
    }
    return depth % 2 === 0;
  });
}

// The shapes whose box, grown by `allowance`, holds the shape's box.
function indexedCandidates(
  boxes: ReadonlyArray<ShapeBox | null>,
  allowance: number,
): (box: ShapeBox) => ReadonlyArray<number> {
  const grown = boxes.flatMap((box) =>
    box === null
      ? []
      : [
          {
            minX: box.minX - allowance,
            minY: box.minY - allowance,
            maxX: box.maxX + allowance,
            maxY: box.maxY + allowance,
            index: box.index,
          },
        ],
  );
  const index = ContourBoxIndex.create(grown);
  return (box) =>
    index
      .query(box)
      .filter(
        (candidate) =>
          candidate.minX <= box.minX &&
          candidate.minY <= box.minY &&
          candidate.maxX >= box.maxX &&
          candidate.maxY >= box.maxY,
      )
      .map((candidate) => candidate.index);
}

function everyShape(boxes: ReadonlyArray<ShapeBox | null>): () => ReadonlyArray<number> {
  const all = boxes.flatMap((box) => (box === null ? [] : [box.index]));
  return () => all;
}

function boxOf(points: ReadonlyArray<Vec2>): ContourBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

// NaN when any point is not a number, Infinity when a shape has no points.
function largestCoordinate(boxes: ReadonlyArray<ContourBox | null>): number {
  let largest = 0;
  for (const box of boxes) {
    // A gap in a sparse layer reads as undefined; it holds no shape.
    if (box === null || box === undefined) continue;
    largest = Math.max(
      largest,
      Math.abs(box.minX),
      Math.abs(box.minY),
      Math.abs(box.maxX),
      Math.abs(box.maxY),
    );
  }
  return largest;
}
