/**
 * T1-37: the ConnectionPanelMain Offset fill button must stay disabled until
 * offset fill is implemented in the optimizer.
 *
 * Run: npx tsx tests/connection-panel-offset-button-disabled.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;

function assertContract(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

const ROOT = process.cwd();
const SOURCE = readFileSync(resolve(ROOT, 'src/ui/components/ConnectionPanelMain.tsx'), 'utf-8');

console.log('\n=== T1-37 offset fill button disabled ===\n');

const offsetIndex = SOURCE.indexOf("mode: 'offset' as const");
assertContract(offsetIndex > -1, 'offset mode entry exists in fill-mode button list');

const windowStart = SOURCE.lastIndexOf('([', offsetIndex);
const windowEnd = SOURCE.indexOf('),\n        ),', offsetIndex);
const block = SOURCE.slice(windowStart, windowEnd > -1 ? windowEnd : offsetIndex + 4000);

assertContract(
  /Offset \(coming soon\)/.test(block),
  'offset button label says "Offset (coming soon)"',
);
assertContract(
  /disabled:\s*f\.mode\s*===\s*'offset'/.test(block),
  "offset button has disabled: f.mode === 'offset'",
);
assertContract(
  /if\s*\(\s*f\.mode\s*===\s*'offset'\s*\)\s*return/.test(block),
  'onClick returns early for offset',
);
assertContract(
  /cursor:\s*f\.mode\s*===\s*'offset'\s*\?\s*'not-allowed'/.test(block),
  'cursor is not-allowed for offset',
);
assertContract(
  /title:\s*f\.mode\s*===\s*'offset'\s*\?\s*'Offset fill not yet implemented'/.test(block),
  'title explains offset fill is not implemented',
);
assertContract(
  !/disabled:\s*true/.test(block),
  'line and cross-hatch are not unconditionally disabled',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
