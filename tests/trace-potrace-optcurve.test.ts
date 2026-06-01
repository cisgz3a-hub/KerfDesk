/**
 * Potrace curve-optimization contracts.
 *
 * Run: node --import tsx tests/trace-potrace-optcurve.test.ts
 */
import {
  optimizePotraceCurve,
  potraceCurveToPathSegments,
  smoothClosedPolygonToPotraceCurve,
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

console.log('\n=== Potrace optcurve formula ===\n');

{
  const roundedOctagon = Array.from({ length: 8 }, (_, index) => {
    const angle = 2 * Math.PI * index / 8;
    return {
      x: 10 + 8 * Math.cos(angle),
      y: 10 + 8 * Math.sin(angle),
    };
  });

  const smoothed = smoothClosedPolygonToPotraceCurve(roundedOctagon, 1);
  const optimized = optimizePotraceCurve(smoothed, 0.2);

  assert(optimized.segments.length < smoothed.segments.length, 'curve optimization merges compatible adjacent Beziers');
  assert(
    potraceCurveToPathSegments(optimized).some(segment => segment.type === 'cubic'),
    'optimized smooth curve remains cubic where eligible',
  );
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

  const smoothed = smoothClosedPolygonToPotraceCurve(polygon, 1);
  const optimized = optimizePotraceCurve(smoothed, 0);

  assert(
    optimized.segments.length === smoothed.segments.length,
    'opttolerance=0 keeps the unoptimized segment count',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
