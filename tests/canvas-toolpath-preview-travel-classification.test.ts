import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildToolpathPreviewSegments } from '../src/ui/components/canvas/canvasViewportHelpers';
import type { Move } from '../src/core/plan/Plan';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertSegment(
  actual: ReturnType<typeof buildToolpathPreviewSegments>[number],
  expected: {
    type: 'rapid' | 'travel' | 'cut';
    from: { x: number; y: number };
    to: { x: number; y: number };
  },
  label: string,
): void {
  assert(actual.type === expected.type, `${label}: type ${actual.type} !== ${expected.type}`);
  assert(actual.from.x === expected.from.x && actual.from.y === expected.from.y,
    `${label}: from (${actual.from.x}, ${actual.from.y}) !== (${expected.from.x}, ${expected.from.y})`);
  assert(actual.to.x === expected.to.x && actual.to.y === expected.to.y,
    `${label}: to (${actual.to.x}, ${actual.to.y}) !== (${expected.to.x}, ${expected.to.y})`);
}

console.log('\n=== F45-13-002 canvas toolpath preview travel classification ===\n');

const moves: Move[] = [
  { type: 'marker', sourceObjectIds: ['shape-a'] },
  { type: 'rapid', to: { x: 10, y: 0 } },
  { type: 'linear', to: { x: 20, y: 0 }, power: 65, speed: 1000 },
  { type: 'linear', to: { x: 30, y: 0 }, power: 0, speed: 1000 },
  { type: 'linear', to: { x: 40, y: 10 }, power: 25, speed: 800 },
  { type: 'laserOff' },
  { type: 'rapid', to: { x: 5, y: 5 } },
];

const segments = buildToolpathPreviewSegments(moves);

assert(segments.length === 5, `expected 5 visible motion segments, got ${segments.length}`);
assertSegment(segments[0]!, { type: 'rapid', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }, 'rapid segment');
assertSegment(segments[1]!, { type: 'cut', from: { x: 10, y: 0 }, to: { x: 20, y: 0 } }, 'powered linear segment');
assertSegment(segments[2]!, { type: 'travel', from: { x: 20, y: 0 }, to: { x: 30, y: 0 } }, 'zero-power linear segment');
assertSegment(segments[3]!, { type: 'cut', from: { x: 30, y: 0 }, to: { x: 40, y: 10 } }, 'powered linear after travel');
assertSegment(segments[4]!, { type: 'rapid', from: { x: 40, y: 10 }, to: { x: 5, y: 5 } }, 'rapid after non-positional move');

const canvasSource = readFileSync(resolve(process.cwd(), 'src/ui/components/CanvasViewport.tsx'), 'utf8');
assert(
  canvasSource.includes('buildToolpathPreviewSegments'),
  'CanvasViewport uses the shared toolpath preview segment classifier',
);
assert(
  !/m\.power\s*>\s*0[\s\S]{0,220}ctx\.lineTo/.test(canvasSource),
  'CanvasViewport no longer hides zero-power linear moves by only stroking power > 0 linears',
);

console.log('Canvas toolpath preview classifies rapid, cut, and laser-off feed travel moves.');
