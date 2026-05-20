/**
 * F45-04-004: Legacy DXF POLYLINE/VERTEX/SEQEND entities must import
 * instead of being silently dropped.
 *
 * Run: npx tsx tests/dxf-polyline-vertex-import.test.ts
 */
import { createScene } from '../src/core/scene/Scene';
import { importDxfIntoScene } from '../src/import/dxf';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  fail ${message}`);
  }
}

function closeTo(actual: number, expected: number, eps = 1e-6): boolean {
  return Math.abs(actual - expected) <= eps;
}

function legacyPolylineDxf(options: {
  closed?: boolean;
  insunits?: number;
  points?: Array<[number, number]>;
} = {}): string {
  const points = options.points ?? [
    [0, 0],
    [10, 0],
    [10, 5],
  ];
  const header = options.insunits == null
    ? []
    : [
        '0', 'SECTION',
        '2', 'HEADER',
        '9', '$INSUNITS',
        '70', String(options.insunits),
        '0', 'ENDSEC',
      ];
  return [
    ...header,
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'POLYLINE',
    '8', 'Cut',
    '66', '1',
    '70', options.closed ? '1' : '0',
    ...points.flatMap(([x, y]) => [
      '0', 'VERTEX',
      '8', 'Cut',
      '10', String(x),
      '20', String(y),
      '30', '0',
    ]),
    '0', 'SEQEND',
    '0', 'ENDSEC',
    '0', 'EOF',
  ].join('\n');
}

console.log('\n=== F45-04-004 DXF legacy POLYLINE/VERTEX import ===\n');

{
  const scene = importDxfIntoScene(
    legacyPolylineDxf({ closed: true }),
    createScene(100, 100, 'legacy closed polyline'),
  );
  const geometry = scene.objects[0]?.geometry;
  assert(scene.objects.length === 1, 'legacy POLYLINE/VERTEX imports one scene object');
  assert(geometry?.type === 'polygon', 'legacy closed POLYLINE imports as polygon geometry');
  if (geometry?.type === 'polygon') {
    assert(geometry.closed === true, 'legacy POLYLINE closed flag is preserved');
    assert(geometry.points.length === 3, 'legacy POLYLINE preserves vertex count');
    assert(closeTo(geometry.points[1]?.x ?? NaN, 10), 'legacy POLYLINE preserves vertex X coordinates');
    assert(closeTo(geometry.points[2]?.y ?? NaN, 5), 'legacy POLYLINE preserves vertex Y coordinates');
  }
}

{
  const scene = importDxfIntoScene(
    legacyPolylineDxf({ closed: false, insunits: 1, points: [[0, 0], [2, 0]] }),
    createScene(100, 100, 'legacy inch polyline'),
  );
  const geometry = scene.objects[0]?.geometry;
  assert(geometry?.type === 'polygon', 'legacy open POLYLINE imports as polygon geometry');
  if (geometry?.type === 'polygon') {
    assert(geometry.closed === false, 'legacy POLYLINE open flag is preserved');
    assert(closeTo(geometry.points[1]?.x ?? NaN, 50.8), 'legacy inch POLYLINE is scaled to millimeters');
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
