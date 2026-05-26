/**
 * PRT4040 home-button safety gate.
 *
 * Run: npx tsx tests/prt4040-connection-home-gate.test.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const jogSrc = readFileSync(resolve(here, '../src/ui/components/connection/Jog.tsx'), 'utf-8');
const panelSrc = readFileSync(resolve(here, '../src/ui/components/ConnectionPanelMain.tsx'), 'utf-8');

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== PRT4040 home gate ===\n');

assert(/canHome\?: boolean/.test(jogSrc), 'Jog accepts canHome prop');
assert(/disabled:\s*!canHome/.test(jogSrc), 'Home button is disabled when canHome is false');
assert(/Home disabled/.test(jogSrc), 'disabled Home tooltip explains unavailable Home');

assert(/const canHome =/.test(panelSrc), 'ConnectionPanelMain computes canHome');
assert(/canExecuteOperation\('home'/.test(panelSrc), 'canHome uses the central operation gate');
assert(
  !/activeProfile\?\.homingEnabled === true[\s\S]{0,120}activeOperation === null/.test(panelSrc),
  'GRBL4040: canHome is not hard-disabled only because no device profile is selected',
);
assert(/if \(!canHome\)/.test(panelSrc), 'handleHome refuses when canHome is false');
assert(/canHome,/.test(panelSrc), 'ConnectionPanelMain passes canHome into Jog');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
