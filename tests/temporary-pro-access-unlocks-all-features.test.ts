/**
 * Temporary commercial policy: payment gating is disabled until a
 * future payment flow is added back. Everyone should be able to use
 * Pro mode and all Pro features, even with a free/no-license state.
 *
 * Run: npx tsx tests/temporary-pro-access-unlocks-all-features.test.ts
 */
import {
  assertFeature,
  canUseFeature,
  entitlementService,
  hasPro,
  PRO_FEATURES,
  type EntitlementState,
} from '../src/entitlements';

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

function setEntitlement(state: EntitlementState): void {
  (entitlementService as unknown as { state: EntitlementState }).state = state;
}

console.log('\n=== temporary Pro access unlocks all features ===\n');

setEntitlement({ tier: 'free', hasPro: false, status: 'free' });

assert(hasPro() === true, 'global Pro mode is available without payment');

for (const feature of PRO_FEATURES) {
  assert(canUseFeature(feature) === true, `${feature} is available without payment`);
  let threw = false;
  try {
    assertFeature(feature);
  } catch {
    threw = true;
  }
  assert(!threw, `${feature} assertFeature does not throw without payment`);
}

const state = entitlementService.getState();
assert(state.hasPro === true, 'public entitlement state reports Pro access');
assert(
  state.features?.length === PRO_FEATURES.length,
  'public entitlement state lists every Pro feature',
);
assert(state.label === 'Temporary Pro access', 'public entitlement state labels temporary access');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
