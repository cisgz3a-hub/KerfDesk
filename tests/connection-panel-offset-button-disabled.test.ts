/**
 * T1-37 + T2-61: offset fill stays disabled in the editing panel, and the
 * connection panel no longer exposes fill-mode editing controls at all.
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
const CONNECTION_PANEL = readFileSync(resolve(ROOT, 'src/ui/components/ConnectionPanelMain.tsx'), 'utf-8');
const LAYER_PANEL = readFileSync(resolve(ROOT, 'src/ui/components/LayerPanel.tsx'), 'utf-8');

console.log('\n=== T1-37 offset fill button disabled ===\n');

const fillModeIndex = LAYER_PANEL.indexOf("React.createElement('span', { style: settingsLabelStyle }, 'Fill mode')");
assertContract(fillModeIndex > -1, 'LayerPanel owns the fill-mode editing control');

const windowEnd = LAYER_PANEL.indexOf("React.createElement('label', { style: { ...fieldStyle, marginTop: 4 } },", fillModeIndex + 1);
const block = LAYER_PANEL.slice(fillModeIndex, windowEnd > -1 ? windowEnd : fillModeIndex + 2000);

assertContract(
  !/mode:\s*'offset'\s*as\s*const/.test(CONNECTION_PANEL),
  'ConnectionPanelMain no longer exposes an offset fill-mode button entry',
);
assertContract(
  !/onUpdateLayerFillMode/.test(CONNECTION_PANEL),
  'ConnectionPanelMain no longer mutates layer fill modes',
);
assertContract(
  /Offset fill \(coming soon\)/.test(block),
  'LayerPanel offset option label says "Offset fill (coming soon)"',
);
assertContract(
  /value:\s*'offset',\s*disabled:\s*true/.test(block),
  'LayerPanel offset option is hard-disabled',
);
assertContract(
  /if\s*\(\s*v\s*===\s*'offset'\s*\)\s*return/.test(block),
  'LayerPanel onChange returns early for offset',
);
assertContract(
  /value:\s*'line'/.test(block) && /value:\s*'cross-hatch'/.test(block),
  'line and cross-hatch options remain present in LayerPanel',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
