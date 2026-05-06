/**
 * @copyright (c) 2025 LaserForge. All rights reserved.
 */
import { strict as assert } from 'node:assert';
import {
  compoundPathFromContours,
  contourArea,
  contourBounds,
  flattenCompoundPathToContours,
  makeContour,
} from '../src/core/geometry/CompoundPath';
import type { Point } from '../src/core/types';

function square(x: number, y: number, size: number): Point[] {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
}

const outer = makeContour(square(0, 0, 10), true, 'outer');
const hole = makeContour(square(3, 3, 4), true, 'hole');
const open = makeContour([{ x: 20, y: 2 }, { x: 25, y: 8 }], false);

assert.equal(outer.role, 'outer');
assert.equal(hole.role, 'hole');
assert.equal(open.role, 'open');
assert.equal(outer.winding, 'ccw');
assert.equal(contourArea(outer), 100);
assert.deepEqual(contourBounds(hole), { minX: 3, minY: 3, maxX: 7, maxY: 7 });

const compound = compoundPathFromContours({
  sourceObjectId: 'obj-compound',
  contours: [outer, hole, open],
  fillRule: 'nonzero',
});

assert.equal(compound.sourceObjectId, 'obj-compound');
assert.equal(compound.fillRule, 'nonzero');
assert.deepEqual(compound.bounds, { minX: 0, minY: 0, maxX: 25, maxY: 10 });
assert.deepEqual(compound.contours.map(c => c.role), ['outer', 'hole', 'open']);

const flattened = flattenCompoundPathToContours(compound);
assert.deepEqual(flattened.map(c => c.sourceObjectId), ['obj-compound', 'obj-compound', 'obj-compound']);
assert.deepEqual(flattened.map(c => c.contourRole), ['outer', 'hole', 'open']);
assert.deepEqual(flattened[0].points, outer.points);

assert.throws(
  () => makeContour([{ x: 0, y: 0 }, { x: 1, y: 1 }], false, 'outer'),
  /open contour/i,
);

