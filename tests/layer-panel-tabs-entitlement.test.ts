/**
 * S25-04-001: basic tab controls must not appear enabled when the
 * compiler will strip tabs for an unentitled user.
 *
 * Run: npx tsx tests/layer-panel-tabs-entitlement.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

console.log('\n=== S25-04-001 LayerPanel tab entitlement gate ===\n');

const layerPanel = readFileSync(resolve('src/ui/components/LayerPanel.tsx'), 'utf8');
const compiler = readFileSync(resolve('src/core/job/JobCompiler.ts'), 'utf8');

assert(/S25-04-001/.test(layerPanel), 'LayerPanel carries S25-04-001 marker');
assert(
  /const\s+tabsFeatureUnlocked\s*=\s*checkProAccess\('tabs'\)/.test(layerPanel),
  'LayerPanel derives tab UI availability from the same feature entitlement used by compiler policy',
);
assert(
  /const\s+simpleTabsOn\s*=\s*tabsFeatureUnlocked\s*&&/.test(layerPanel),
  'LayerPanel only displays simple tabs as enabled when tabs entitlement is available',
);
assert(
  /disabled:\s*!tabsFeatureUnlocked/.test(layerPanel),
  'LayerPanel disables the basic tabs toggle when tabs entitlement is unavailable',
);
assert(
  /Cut tabs require Pro/.test(layerPanel),
  'Locked tabs control surfaces a clear user-facing reason instead of silently enabling stripped output',
);
assert(
  /activeLayer\.settings\.tabs\?\.enabled\s*&&\s*React\.createElement\('div'/.test(layerPanel) === false,
  'LayerPanel no longer shows enabled tab detail blocks directly from raw layer settings',
);

assert(
  /allowTabs:\s*canUseFeature\('tabs'\)/.test(compiler),
  'JobCompiler still enforces the tabs entitlement at compile time',
);
assert(
  /recordDropped\(entitlementPolicy,\s*'tabs'/.test(compiler),
  'JobCompiler still records stripped tabs as entitlement-dropped output',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
