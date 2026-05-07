/**
 * T2-15 Pass 2: FillGenerator should be able to consume CompoundPath
 * inputs without pooling unrelated objects into one global even-odd edge set.
 *
 * Run: npx tsx tests/compound-fill-generator.test.ts
 */
import { strict as assert } from 'node:assert';
import {
  compoundPathFromContours,
  makeContour,
} from '../src/core/geometry/CompoundPath';
import { generateFillRowsForCompoundPaths } from '../src/core/plan/FillGenerator';
import type { Point } from '../src/core/types';

function square(x: number, y: number, size: number): Point[] {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
}

function segmentLength(rowIndex: number, segmentIndex: number, rows: ReturnType<typeof generateFillRowsForCompoundPaths>): number {
  const segment = rows[rowIndex]!.segments[segmentIndex]!;
  return Math.abs(segment.actualTo.x - segment.actualFrom.x);
}

const settings = {
  interval: 5,
  angle: 0,
  biDirectional: false,
  overscanning: 0,
};

const first = compoundPathFromContours({
  sourceObjectId: 'first',
  contours: [makeContour(square(0, 0, 10), true, 'outer')],
});
const second = compoundPathFromContours({
  sourceObjectId: 'second',
  contours: [makeContour(square(0, 0, 10), true, 'outer')],
});

const overlappingRows = generateFillRowsForCompoundPaths([first, second], settings);
assert.equal(overlappingRows.length, 4, 'overlapping compounds are scanned independently');
assert.equal(segmentLength(0, 0, overlappingRows), 10, 'first compound row remains full width');
assert.equal(segmentLength(2, 0, overlappingRows), 10, 'second compound row remains full width');

const donut = compoundPathFromContours({
  sourceObjectId: 'donut',
  contours: [
    makeContour(square(0, 0, 10), true, 'outer'),
    makeContour(square(3, 3, 4), true, 'hole'),
  ],
});

const donutRows = generateFillRowsForCompoundPaths([donut], {
  ...settings,
  interval: 2,
});
assert.ok(
  donutRows.some(row => row.segments.length === 2),
  'compound holes still split rows inside one compound',
);

console.log('compound fill generator: ok');
