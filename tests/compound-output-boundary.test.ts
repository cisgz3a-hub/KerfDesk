/**
 * T2-15 Pass 5: final FlatPath conversion tags CompoundPath contour roles.
 */
import assert from 'node:assert/strict';
import {
  compoundPathFromContours,
  makeContour,
} from '../src/core/geometry/CompoundPath';
import { flatPathsFromCompoundPath, orderCompoundFlatPathsForCutting } from '../src/core/job/CompoundPathOutput';

function square(x: number, y: number, side: number): Array<{ x: number; y: number }> {
  return [
    { x, y },
    { x: x + side, y },
    { x: x + side, y: y + side },
    { x, y: y + side },
  ];
}

const compound = compoundPathFromContours({
  sourceObjectId: 'compound-object',
  contours: [
    makeContour(square(0, 0, 100), true, 'outer'),
    makeContour(square(20, 20, 20), true, 'hole'),
    makeContour(square(50, 50, 10), true, 'island'),
    makeContour([{ x: 0, y: 120 }, { x: 20, y: 120 }], false, 'open'),
  ],
});

const flat = flatPathsFromCompoundPath(compound, { powerScale: 0.5 });
assert.equal(flat.length, 4, 'every contour reaches the FlatPath output boundary');
assert.deepEqual(
  flat.map(path => path.contourRole),
  ['outer', 'hole', 'island', 'open'],
  'FlatPaths retain explicit contour roles',
);
assert.deepEqual(
  flat.map(path => path.compoundId),
  ['compound-object', 'compound-object', 'compound-object', 'compound-object'],
  'FlatPaths retain their source compound id',
);
assert.deepEqual(
  flat.map(path => path.contourIndex),
  [0, 1, 2, 3],
  'FlatPaths retain source contour index',
);
assert.ok(flat.every(path => path.powerScale === 0.5), 'power scale is carried to every output FlatPath');
assert.ok(flat.find(path => path.contourRole === 'open')?.closed === false, 'open contour stays open');

const cuttingOrder = orderCompoundFlatPathsForCutting(flat);
assert.deepEqual(
  cuttingOrder.map(path => path.contourRole),
  ['hole', 'island', 'outer', 'open'],
  'role-aware cutting order keeps inner compound contours before outers and open contours last',
);

console.log('compound output boundary: ok');
