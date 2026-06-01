/**
 * Potrace polygon-stage contracts.
 *
 * Run: node --import tsx tests/trace-potrace-polygon.test.ts
 */
import {
  adjustPotraceVertices,
  calculateBestPotracePolygon,
  calculatePotraceLongestStraightSegments,
  potraceSegmentPenalty,
} from '../src/import/trace/PotracePolygonMath';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function assertArrayEqual(actual: ArrayLike<number>, expected: readonly number[], message: string): void {
  const actualArray = Array.from(actual);
  const ok = actualArray.length === expected.length
    && actualArray.every((value, index) => value === expected[index]);
  assert(ok, `${message}: expected [${expected.join(', ')}], got [${actualArray.join(', ')}]`);
}

function assertPointClose(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
  epsilon: number,
  message: string,
): void {
  const dx = Math.abs(actual.x - expected.x);
  const dy = Math.abs(actual.y - expected.y);
  assert(dx <= epsilon && dy <= epsilon, `${message}: expected (${expected.x}, ${expected.y}), got (${actual.x}, ${actual.y})`);
}

console.log('\n=== Potrace polygon formula ===\n');

{
  const penalty = potraceSegmentPenalty([
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
  ], 0, 3);

  assert(Math.abs(penalty) <= 1e-9, `straight runs have zero Potrace penalty (${penalty})`);
}

{
  const square = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 1 },
    { x: 4, y: 2 },
    { x: 4, y: 3 },
    { x: 4, y: 4 },
    { x: 3, y: 4 },
    { x: 2, y: 4 },
    { x: 1, y: 4 },
    { x: 0, y: 4 },
    { x: 0, y: 3 },
    { x: 0, y: 2 },
    { x: 0, y: 1 },
  ];

  const lon = calculatePotraceLongestStraightSegments(square);
  const polygon = calculateBestPotracePolygon(square, lon);
  const vertices = adjustPotraceVertices(square, polygon);

  assertArrayEqual(polygon, [0, 4, 8, 12], 'best polygon keeps one vertex per square corner');
  assertPointClose(vertices[0], { x: 0, y: 0 }, 1e-9, 'adjusted top-left vertex remains on the fitted corner');
  assertPointClose(vertices[1], { x: 4, y: 0 }, 1e-9, 'adjusted top-right vertex remains on the fitted corner');
  assertPointClose(vertices[2], { x: 4, y: 4 }, 1e-9, 'adjusted bottom-right vertex remains on the fitted corner');
  assertPointClose(vertices[3], { x: 0, y: 4 }, 1e-9, 'adjusted bottom-left vertex remains on the fitted corner');
}

{
  const shallowRun = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
  ];

  const straightPenalty = potraceSegmentPenalty(shallowRun, 0, 1);
  const bentPenalty = potraceSegmentPenalty(shallowRun, 0, 3);

  assert(bentPenalty > straightPenalty, `bent runs cost more than straight runs (${bentPenalty} > ${straightPenalty})`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
