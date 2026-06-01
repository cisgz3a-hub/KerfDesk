/**
 * Potrace smoothing/corner-analysis contracts.
 *
 * Run: node --import tsx tests/trace-potrace-smoothing.test.ts
 */
import {
  potraceAlphaForVertex,
  smoothClosedPolygonWithPotraceAlpha,
} from '../src/import/trace/PotraceCurveMath';

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

console.log('\n=== Potrace smoothing formula ===\n');

{
  const alpha = potraceAlphaForVertex(
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  );

  assert(alpha >= 0 && alpha < 1, `convex 90 degree vertex computes roundable alpha (${alpha})`);
}

{
  const polygon = [
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 1 },
    { x: 3, y: 2 },
    { x: 2, y: 3 },
    { x: 1, y: 3 },
    { x: 0, y: 2 },
    { x: 0, y: 1 },
  ];

  const segments = smoothClosedPolygonWithPotraceAlpha(polygon, 1);

  assert(segments.some(segment => segment.type === 'cubic'), 'default alphamax rounds eligible vertices into cubics');
  assert(segments.some(segment => segment.type === 'close'), 'smoothed polygon remains closed');
}

{
  const polygon = [
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 1 },
    { x: 3, y: 2 },
    { x: 2, y: 3 },
    { x: 1, y: 3 },
    { x: 0, y: 2 },
    { x: 0, y: 1 },
  ];

  const segments = smoothClosedPolygonWithPotraceAlpha(polygon, 0);

  assert(
    segments.every(segment => segment.type !== 'cubic'),
    'alphamax=0 keeps the polygon as straight line segments',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
