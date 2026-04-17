import { compileToGcode } from './helpers/compileToGcode';
import { createRectangleCutFixture } from './fixtures/rectangleCut';
import { compareSnapshot } from './helpers/snapshot';

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

console.log('\n=== E2E: Rectangle Cut ===');

const scene = createRectangleCutFixture();
const gcode = compileToGcode(scene, {
  machineWidth: 400,
  machineHeight: 300,
  startMode: 'absolute',
});

assert(gcode.length > 0, 'G-code output is non-empty');
assert(gcode.includes('G21'), 'G-code sets mm units');
assert(gcode.includes('M5'), 'G-code turns laser off at end');

const snap = compareSnapshot('rectangle-cut', gcode);
assert(snap.pass, snap.message);

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
