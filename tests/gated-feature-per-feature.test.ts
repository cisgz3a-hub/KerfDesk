/**
 * T1-followup-safety-gated-feature: pre-fix `gatedFeature(feature, ...)`
 * declared its `feature` argument but its first line was
 * `if (isProUnlocked()) return true` — which delegates to
 * `entitlementService.hasPro()` (blanket pro flag) and ignores `feature`.
 * Net effect: a selective license that grants `state.features =
 * ['nesting']` (T2-89 server tokens) would either pass every feature
 * gate (when hasPro=true) or fail every gate (when hasPro=false),
 * regardless of which feature the UI was actually trying to gate.
 *
 * Post-fix `gatedFeature` calls `checkProAccess(feature)` →
 * `entitlementService.canUse(feature)` → which honors per-feature
 * licenses while preserving blanket-pro semantics (state.features
 * undefined → falls back to hasPro).
 *
 * Run: npx tsx tests/gated-feature-per-feature.test.ts
 */
import { entitlementService } from '../src/entitlements';
import type { ProFeature } from '../src/entitlements';
import { gatedFeature } from '../src/ui/utils/proGate';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

// Monkey-patch canUse + hasPro to drive the gate without spinning up the
// full storage / license-cache machinery. Mirrors the pattern used by
// tests/entitlement-api-split.test.ts.
function withEntitlement<T>(
  stubs: { canUse?: (f: ProFeature) => boolean; hasPro?: () => boolean },
  body: () => T,
): T {
  const svc = entitlementService as unknown as {
    canUse: (f: ProFeature) => boolean;
    hasPro: () => boolean;
  };
  const originalCanUse = svc.canUse.bind(entitlementService);
  const originalHasPro = svc.hasPro.bind(entitlementService);
  if (stubs.canUse) svc.canUse = stubs.canUse;
  if (stubs.hasPro) svc.hasPro = stubs.hasPro;
  try {
    return body();
  } finally {
    svc.canUse = originalCanUse;
    svc.hasPro = originalHasPro;
  }
}

console.log('\n=== T1-followup-safety-gated-feature ===\n');

// -------- per-feature license: only granted features pass --------
withEntitlement(
  {
    canUse: (f) => f === 'nesting',
    hasPro: () => true, // pre-fix would return true for ALL features here
  },
  () => {
    assert(
      gatedFeature('nesting', () => {}) === true,
      'granted feature passes the gate',
    );
    assert(
      gatedFeature('boolean_ops', () => {}) === false,
      'non-granted feature fails the gate even when blanket hasPro=true',
    );
    assert(
      gatedFeature('cross_hatch', () => {}) === false,
      'second non-granted feature also fails',
    );
  },
);

// -------- per-feature license with hasPro=false: granted feature still passes --------
withEntitlement(
  {
    canUse: (f) => f === 'kerf_wizard',
    hasPro: () => false, // pre-fix would return false for ALL features
  },
  () => {
    assert(
      gatedFeature('kerf_wizard', () => {}) === true,
      'granted feature passes even when hasPro=false (per-feature license)',
    );
    assert(
      gatedFeature('nesting', () => {}) === false,
      'non-granted feature fails as expected',
    );
  },
);

// -------- blanket pro (canUse returns true for everything) --------
withEntitlement(
  {
    canUse: () => true,
    hasPro: () => true,
  },
  () => {
    assert(gatedFeature('nesting', () => {}) === true, 'blanket pro: nesting passes');
    assert(gatedFeature('boolean_ops', () => {}) === true, 'blanket pro: boolean_ops passes');
    assert(gatedFeature('material_test', () => {}) === true, 'blanket pro: material_test passes');
  },
);

// -------- no license (free tier) --------
withEntitlement(
  {
    canUse: () => false,
    hasPro: () => false,
  },
  () => {
    assert(gatedFeature('nesting', () => {}) === false, 'no license: nesting blocked');
    assert(gatedFeature('boolean_ops', () => {}) === false, 'no license: boolean_ops blocked');
  },
);

// -------- onLockedAction fires only when access is denied --------
{
  let lockedCalls = 0;
  withEntitlement(
    { canUse: (f) => f === 'nesting', hasPro: () => false },
    () => {
      gatedFeature('nesting', () => { lockedCalls++; });
      gatedFeature('boolean_ops', () => { lockedCalls++; });
    },
  );
  assert(lockedCalls === 1, 'onLockedAction fires once: granted feature did not call it');
}

// -------- gatedFeature uses the feature argument (regression for the audit claim) --------
{
  const featuresQueried: ProFeature[] = [];
  withEntitlement(
    {
      canUse: (f) => {
        featuresQueried.push(f);
        return false;
      },
      hasPro: () => false,
    },
    () => {
      gatedFeature('nesting', () => {});
      gatedFeature('boolean_ops', () => {});
      gatedFeature('material_test', () => {});
    },
  );
  assert(
    featuresQueried.length === 3
      && featuresQueried[0] === 'nesting'
      && featuresQueried[1] === 'boolean_ops'
      && featuresQueried[2] === 'material_test',
    'gatedFeature passes its `feature` arg through to canUse (regression: pre-fix it called isProUnlocked instead)',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
