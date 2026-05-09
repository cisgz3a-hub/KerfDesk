import './helpers/e2eDeterministicIds';

/**
 * E2E: large scene — compile-time budget (no snapshot).
 */

import { makeLargeScene } from './fixtures/largeScene';
import { compileSceneToGcode } from './helpers/compileToGcode';
import { assertSemanticGcode } from './helpers/semanticGcodeAssertions';

const MAX_MS = 2000;
const MIN_LINES = 800;
const MAX_LINES = 50_000;

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

console.log('\n=== E2E: large scene (100 objects, perf budget) ===');

const scene = makeLargeScene();
const start = performance.now();
const gcode = compileSceneToGcode(scene, { startMode: 'current' });
const elapsed = performance.now() - start;
const lineCount = gcode.split('\n').length;

console.log(`  ℹ Compiled 100 objects in ${elapsed.toFixed(0)} ms, ${lineCount} lines`);

assert(elapsed < MAX_MS, `Compile time under ${MAX_MS} ms (got ${elapsed.toFixed(0)})`);
assert(lineCount >= MIN_LINES, `Line count >= ${MIN_LINES} (got ${lineCount})`);
assert(lineCount <= MAX_LINES, `Line count <= ${MAX_LINES} (got ${lineCount})`);
assertSemanticGcode(gcode, assert, {
  expectedDistanceMode: 'relative',
  minBurnSegments: 100,
});
assert(gcode.includes('M2'), 'Contains M2 (program end)');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
