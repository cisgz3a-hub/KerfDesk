/**
 * Origin mode: computeGcodeOffset ignores stored savedOrigin XY (WCS zeroed at click).
 * sendSetOriginWcsCommand: G10 L20 side effect.
 *
 * Run: npx tsx tests/origin-mode-wcs-zero.test.ts
 */

import { computeGcodeOffset } from '../src/core/output/GcodeOrigin';
import { sendSetOriginWcsCommand } from '../src/app/sendSetOriginWcsCommand';
import { makeRectangleCutScene } from './e2e/fixtures/rectangleCut';
import { compileSceneToGcode } from './e2e/helpers/compileToGcode';

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

console.log('\n=== origin-mode-wcs-zero ===');

{
  const sent: string[] = [];
  const ctrl = { sendCommand: (s: string) => { sent.push(s); } };
  const result = sendSetOriginWcsCommand(ctrl);
  assert(sent.length === 1 && sent[0] === 'G10 L20 P1 X0 Y0', 'sendSetOriginWcsCommand emits G10 L20 P1 X0 Y0');
  assert(result.ok === true, 'sendSetOriginWcsCommand success returns ok=true');
}

{
  let throws = false;
  let nullResult: ReturnType<typeof sendSetOriginWcsCommand> | null = null;
  let undefinedResult: ReturnType<typeof sendSetOriginWcsCommand> | null = null;
  try {
    nullResult = sendSetOriginWcsCommand(null);
    undefinedResult = sendSetOriginWcsCommand(undefined);
  } catch {
    throws = true;
  }
  assert(!throws, 'sendSetOriginWcsCommand(null/undefined) does not throw');
  assert(nullResult?.ok === false && nullResult.reason === 'no-controller', 'null controller returns no-controller result');
  assert(undefinedResult?.ok === false && undefinedResult.reason === 'no-controller', 'undefined controller returns no-controller result');
}

{
  const a = computeGcodeOffset('savedOrigin', { minX: 10, minY: 20 }, { x: 999, y: 888 });
  assert(a.x === -10 && a.y === -20, 'savedOrigin offset ignores savedOrigin param (uses -designMin only)');
}

{
  const scene = makeRectangleCutScene();
  const gcode = compileSceneToGcode(scene, {
    startMode: 'savedOrigin',
    savedOrigin: { x: 100, y: 75 },
  });
  assert(
    gcode.includes('G0 X0.000 Y20.000'),
    'savedOrigin compile: first rapid matches design-local WCS origin (not saved canvas 100,75)',
  );
  assert(
    !gcode.includes('G0 X100.000 Y95.000'),
    'savedOrigin compile: does not use pre-change absolute corner at +saved offset',
  );
  assert(
    gcode.includes('G0 X0.000 Y0.000 ; return to job origin'),
    'savedOrigin: return to work origin (0,0) after WCS zero at Set Origin',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
