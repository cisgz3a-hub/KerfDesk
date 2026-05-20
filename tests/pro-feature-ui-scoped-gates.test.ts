/**
 * F45-16-002: partial-feature licenses must not expose compiler-gated UI
 * controls for features absent from the entitlement token.
 *
 * Run: npx tsx tests/pro-feature-ui-scoped-gates.test.ts
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

console.log('\n=== F45-16-002 feature-scoped Pro UI gates ===\n');

const layerPanel = readFileSync(resolve('src/ui/components/LayerPanel.tsx'), 'utf8');
const propertiesPanel = readFileSync(resolve('src/ui/components/PropertiesPanel.tsx'), 'utf8');
const entitlementService = readFileSync(resolve('src/entitlements/EntitlementService.ts'), 'utf8');

assert(
  /import\s+\{\s*checkProAccess\s*\}\s+from\s+'(?:\.{1,2}\/)+utils\/proGate'/.test(layerPanel),
  'LayerPanel imports checkProAccess for feature-scoped UI gates',
);
assert(
  /const\s+tabsFeatureUnlocked\s*=\s*checkProAccess\('tabs'\)/.test(layerPanel),
  'LayerPanel gates tabs UI on the tabs feature, not blanket Pro',
);
assert(
  /const\s+crossHatchFeatureUnlocked\s*=\s*checkProAccess\('cross_hatch'\)/.test(layerPanel),
  'LayerPanel gates cross-hatch UI on the cross_hatch feature',
);
assert(
  /const\s+overcutFeatureUnlocked\s*=\s*checkProAccess\('overcut'\)/.test(layerPanel),
  'LayerPanel gates overcut UI on the overcut feature',
);
assert(
  /const\s+leadInFeatureUnlocked\s*=\s*checkProAccess\('lead_in'\)/.test(layerPanel),
  'LayerPanel gates lead-in UI on the lead_in feature',
);
assert(
  /disabled:\s*!crossHatchFeatureUnlocked/.test(layerPanel),
  'Cross-hatch option disables from the cross_hatch feature gate',
);
assert(
  /overcutFeatureUnlocked\s*&&\s*React\.createElement\('div',\s*\{\s*key:\s*'overcut'/.test(layerPanel),
  'Overcut controls render only when the overcut feature is granted',
);
assert(
  /leadInFeatureUnlocked\s*&&\s*React\.createElement\('div',\s*\{\s*key:\s*'lead-in'/.test(layerPanel),
  'Lead-in controls render only when the lead_in feature is granted',
);
assert(
  /tabsFeatureUnlocked\s*\?\s*\(\s*simpleTabsOn\s*&&\s*!showTabsCustomize[\s\S]*key:\s*'tab-count'[\s\S]*key:\s*'tab-width'/.test(layerPanel),
  'Advanced tab count/width controls remain behind the tabs feature gate',
);
assert(
  !/LayerPanel[\s\S]*isProUnlocked\(\)/.test(layerPanel),
  'LayerPanel no longer uses blanket Pro state for feature-specific controls',
);

assert(
  /import\s+\{\s*checkProAccess\s*\}\s+from\s+'(?:\.{1,2}\/)+utils\/proGate'/.test(propertiesPanel),
  'PropertiesPanel imports checkProAccess for feature-scoped UI gates',
);
assert(
  /checkProAccess\('cut_start_point'\)/.test(propertiesPanel),
  'PropertiesPanel gates Cut Start Point on the cut_start_point feature',
);
assert(
  /checkProAccess\('power_scale'\)/.test(propertiesPanel),
  'PropertiesPanel gates Power Scale on the power_scale feature',
);
assert(
  !/PropertiesPanel[\s\S]*isProUnlocked\(\)/.test(propertiesPanel),
  'PropertiesPanel no longer uses blanket Pro state for feature-specific controls',
);

assert(
  /if\s*\(this\.state\.features\)\s*\{[\s\S]*return\s+this\.state\.features\.includes\(feature\);[\s\S]*return\s+this\.state\.hasPro;/.test(entitlementService),
  'EntitlementService still preserves legacy blanket-Pro fallback when no features field is present',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
