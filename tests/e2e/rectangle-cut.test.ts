import './helpers/e2eDeterministicIds';

/**
 * E2E: rectangle cut produces stable G-code.
 *
 * Exercises the full pipeline (compile → optimize → transform → output)
 * and snapshot-matches the GRBL output. Complements pipeline.test.ts
 * which makes category-level assertions but no byte-level checks.
 */

import { makeRectangleCutScene } from './fixtures/rectangleCut';
import { compileSceneToGcode } from './helpers/compileToGcode';
import { expectMatchesSnapshot } from './helpers/snapshot';

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

console.log('\n=== E2E: rectangle cut ===');

try {
  const scene = makeRectangleCutScene();
  const gcode = compileSceneToGcode(scene, { startMode: 'current' });

  // Structural checks that don't require a snapshot — fast-fail before diff.
  assert(gcode.includes('G21'), 'Includes G21 (mm mode)');
  assert(gcode.includes('G90'), 'Includes G90 (absolute coords)');
  assert(gcode.includes('M4'), 'Includes M4 (dynamic laser)');
  assert(gcode.includes('M5'), 'Includes M5 (laser off)');

  // Byte-level snapshot — catches all subtler regressions.
  expectMatchesSnapshot(gcode, 'rectangle-cut.gcode');
  passed++;
  console.log(`  ✓ Snapshot verified (${gcode.length} chars)`);
} catch (err) {
  failed++;
  console.error(`  ✗ ${(err as Error).message}`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
