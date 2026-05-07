/**
 * T2-15 Pass 3: kerf offset should accept CompoundPath directly.
 *
 * The old offset path has to infer holes from loose path containment.
 * This test pins the new CompoundPath-native entry point so explicit
 * outer/hole/island roles survive until the offset boundary.
 */
import assert from 'node:assert/strict';
import {
  compoundPathFromContours,
  makeContour,
} from '../src/core/geometry/CompoundPath';
import { compoundPathToOffsetMultiPolygon, offsetCompoundPath } from '../src/geometry/OffsetPath';
import type { PathGeometry, SubPath } from '../src/core/scene/SceneObject';

function square(x: number, y: number, side: number): Array<{ x: number; y: number }> {
  return [
    { x, y },
    { x: x + side, y },
    { x: x + side, y: y + side },
    { x, y: y + side },
  ];
}

function boundsOfSubPath(sp: SubPath): { width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const segment of sp.segments) {
    if (segment.type !== 'move' && segment.type !== 'line') continue;
    minX = Math.min(minX, segment.to.x);
    minY = Math.min(minY, segment.to.y);
    maxX = Math.max(maxX, segment.to.x);
    maxY = Math.max(maxY, segment.to.y);
  }

  return { width: maxX - minX, height: maxY - minY };
}

function smallestSubPath(geom: PathGeometry): SubPath {
  return [...geom.subPaths].sort((a, b) => {
    const ab = boundsOfSubPath(a);
    const bb = boundsOfSubPath(b);
    return ab.width * ab.height - bb.width * bb.height;
  })[0];
}

const donut = compoundPathFromContours({
  sourceObjectId: 'donut',
  contours: [
    makeContour(square(0, 0, 50), true, 'outer'),
    makeContour(square(15, 15, 20), true, 'hole'),
  ],
});

const multi = compoundPathToOffsetMultiPolygon(donut);
assert.equal(multi.length, 1, 'one compound donut becomes one polygon');
assert.equal(multi[0].length, 2, 'explicit hole remains attached to the outer ring');

const outset = offsetCompoundPath(donut, 1);
assert.ok(outset, 'compound donut offsets successfully');
assert.ok(outset.subPaths.length >= 2, 'offset result keeps outer and hole contours');

const inner = boundsOfSubPath(smallestSubPath(outset));
assert.ok(
  inner.width > 17.6 && inner.width < 18.4 && inner.height > 17.6 && inner.height < 18.4,
  `compound donut +1mm shrinks 20mm hole to about 18mm; got ${inner.width.toFixed(2)}x${inner.height.toFixed(2)}`,
);

const islandCompound = compoundPathFromContours({
  sourceObjectId: 'island',
  contours: [
    makeContour(square(0, 0, 100), true, 'outer'),
    makeContour(square(20, 20, 60), true, 'hole'),
    makeContour(square(40, 40, 20), true, 'island'),
  ],
});

const islandMulti = compoundPathToOffsetMultiPolygon(islandCompound);
assert.equal(islandMulti.length, 2, 'island contour starts its own output polygon');
assert.equal(islandMulti[0].length, 2, 'outer polygon still owns its explicit hole');
assert.equal(islandMulti[1].length, 1, 'island polygon has one outer ring');

assert.equal(offsetCompoundPath(donut, 0), null, 'zero-distance compound offset is a no-op');

console.log('compound offset path: ok');
