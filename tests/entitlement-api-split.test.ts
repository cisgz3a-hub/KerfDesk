/**
 * T1-78: split `requireFeature` into `canUseFeature` (boolean) and
 * `assertFeature` (throws). Verify the new API contract.
 *
 * Phase 3 (`<TBD>`) removed the deprecated `requireFeature` alias. The
 * historical "deprecated alias still works" assertions are gone — the
 * alias-removed regression guard lives in
 * `tests/entitlement-api-migration-phase2b.test.ts` (the global
 * "no internal caller of requireFeature" sweep) plus
 * `tests/entitlement-api-no-deprecated-export.test.ts` (Phase 3
 * regression guard on the exported barrel).
 *
 * Run: npx tsx tests/entitlement-api-split.test.ts
 */
import {
  assertFeature,
  canUseFeature,
  EntitlementError,
  entitlementService,
} from '../src/entitlements';
import type { ProFeature } from '../src/entitlements';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

// Monkey-patch entitlementService.canUse so each test controls the answer
// without spinning up the full storage / license-cache machinery. The
// original is restored in a finally so other tests in the same process
// (the suite runner spawns each file in its own process, but defense in
// depth) see the real implementation.
function withCanUse<T>(stub: (feature: ProFeature) => boolean, body: () => T): T {
  const original = entitlementService.canUse.bind(entitlementService);
  (entitlementService as unknown as { canUse: (f: ProFeature) => boolean }).canUse = stub;
  try {
    return body();
  } finally {
    (entitlementService as unknown as { canUse: (f: ProFeature) => boolean }).canUse = original;
  }
}

console.log('T1-78 entitlement API split contract:');

// canUseFeature returns boolean and delegates to entitlementService.canUse.
withCanUse((f) => f === 'nesting', () => {
  assert(canUseFeature('nesting') === true, 'canUseFeature returns true when entitled');
  assert(canUseFeature('cross_hatch') === false, 'canUseFeature returns false when not entitled');
  assert(typeof canUseFeature('nesting') === 'boolean', 'canUseFeature return type is boolean');
});

// assertFeature does not throw when entitled.
withCanUse(() => true, () => {
  let threw = false;
  try {
    assertFeature('nesting');
  } catch {
    threw = true;
  }
  assert(!threw, 'assertFeature does not throw when entitled');
});

// assertFeature throws EntitlementError when not entitled, with the feature
// preserved on the error so callers can format messages from data.
withCanUse(() => false, () => {
  let caught: unknown = null;
  try {
    assertFeature('nesting');
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof EntitlementError, 'assertFeature throws EntitlementError when not entitled');
  if (caught instanceof EntitlementError) {
    assert(caught.feature === 'nesting', 'EntitlementError.feature carries the requested feature');
    assert(caught.name === 'EntitlementError', 'EntitlementError.name is set');
    assert(caught.message.includes('nesting'), 'EntitlementError.message references the feature');
  }
});

// EntitlementError construction directly — no service interaction needed.
const direct = new EntitlementError('cross_hatch', 'custom message');
assert(direct.feature === 'cross_hatch', 'EntitlementError preserves feature on direct construction');
assert(direct.message === 'custom message', 'EntitlementError accepts a custom message');
assert(direct instanceof Error, 'EntitlementError extends Error');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
