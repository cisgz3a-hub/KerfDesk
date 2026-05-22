/**
 * T2-15 Pass 4: boolean operations should preserve CompoundPath roles.
 */
import assert from 'node:assert/strict';
import {
  compoundPathFromContours,
  makeContour,
} from '../src/core/geometry/CompoundPath';
import { booleanCompoundPaths } from '../src/geometry/BooleanOps';
import { entitlementService, type EntitlementState } from '../src/entitlements';

function setEntitlement(state: EntitlementState): void {
  (entitlementService as unknown as { state: EntitlementState }).state = state;
}

function square(x: number, y: number, side: number): Array<{ x: number; y: number }> {
  return [
    { x, y },
    { x: x + side, y },
    { x: x + side, y: y + side },
    { x, y: y + side },
  ];
}

function oneSquare(id: string, x: number, y: number, side: number) {
  return compoundPathFromContours({
    sourceObjectId: id,
    contours: [makeContour(square(x, y, side), true, 'outer')],
  });
}

function contourBounds(points: readonly { x: number; y: number }[]) {
  return points.reduce(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.x),
      minY: Math.min(acc.minY, p.y),
      maxX: Math.max(acc.maxX, p.x),
      maxY: Math.max(acc.maxY, p.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

setEntitlement({ tier: 'developer', hasPro: true });

const outer = oneSquare('outer', 0, 0, 50);
const cutter = oneSquare('cutter', 15, 15, 20);

const donut = booleanCompoundPaths(outer, cutter, 'subtract');
assert.ok(donut, 'subtracting an inner square produces a compound result');
assert.equal(donut.sourceObjectId, 'outer-subtract-cutter');
assert.deepEqual(
  donut.contours.map(contour => contour.role),
  ['outer', 'hole'],
  'subtract result keeps the cutout as an explicit hole contour',
);
const hole = donut.contours.find(contour => contour.role === 'hole');
assert.ok(hole, 'subtract result has a hole contour');
assert.deepEqual(
  contourBounds(hole.points),
  { minX: 15, minY: 15, maxX: 35, maxY: 35 },
  'hole contour keeps the cutter bounds',
);

const left = oneSquare('left', 0, 0, 10);
const right = oneSquare('right', 30, 0, 10);
const union = booleanCompoundPaths(left, right, 'union');
assert.ok(union, 'disjoint union produces a compound result');
assert.deepEqual(
  union.contours.map(contour => contour.role),
  ['outer', 'outer'],
  'disjoint union keeps both islands as explicit outer contours',
);

setEntitlement({ tier: 'free', hasPro: false });
assert.ok(
  booleanCompoundPaths(left, right, 'union'),
  'compound boolean operations remain available during temporary Pro access',
);

console.log('compound boolean ops: ok');
