import './helpers/e2eDeterministicIds';

/**
 * E2E: engrave fill — raster scanline G-code.
 */

import { makeEngraveFillScene } from './fixtures/engraveFill';
import { compileSceneToGcode } from './helpers/compileToGcode';
import { assertSemanticGcode } from './helpers/semanticGcodeAssertions';
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

console.log('\n=== E2E: engrave-fill ===');

try {
  const scene = makeEngraveFillScene();
  const gcode = compileSceneToGcode(scene, { startMode: 'current' });
  const lines = gcode.split('\n').length;
  assertSemanticGcode(gcode, assert, {
    expectedDistanceMode: 'relative',
    expectedBurnWidth: 40,
    expectedBurnHeight: 29.9,
    minBurnSegments: 80,
    tolerance: 0.25,
  });

  assert(gcode.includes('Engrave'), 'Comment references Engrave layer');
  assert(lines > 80, `Raster fill yields many lines (got ${lines})`);
  assert(/^G1 .*F\d+.*S\d+/m.test(gcode), 'Has raster-style G1 F S lines');

  expectMatchesSnapshot(gcode, 'engrave-fill.gcode');
  passed++;
  console.log(`  ✓ Snapshot verified (${gcode.length} chars)`);
} catch (err) {
  failed++;
  console.error(`  ✗ ${(err as Error).message}`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
