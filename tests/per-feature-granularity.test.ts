/**
 * T2-92: per-feature granular `canUse`. Pre-T2-92 the method was
 * `canUse(feature: ProFeature) { void feature; return this.state.hasPro }`
 * — every Pro feature got the same answer. T2-92 introduces a `features?`
 * array on EntitlementState; canUse consults it (modulo the
 * developer/tester_permanent wildcards) and falls back to hasPro when
 * the array is undefined (legacy back-compat).
 *
 * Run: npx tsx tests/per-feature-granularity.test.ts
 */
import { entitlementService } from '../src/entitlements';
import type { EntitlementState, ProFeature } from '../src/entitlements/types';
import { PRO_FEATURES } from '../src/entitlements/types';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T2-92 Per-feature granularity ===\n');

// Direct mutation of the private `state` field for test setup.
// EntitlementService's setState boundary populates statusDetail; for
// these tests we only care about the canUse rules, so a partial
// override is fine. Restored at the end.
type WithState = { state: EntitlementState };
function withState(next: Partial<EntitlementState>, body: () => void): void {
  const svc = entitlementService as unknown as WithState;
  const original = svc.state;
  svc.state = { ...original, ...next };
  try {
    body();
  } finally {
    svc.state = original;
  }
}

void (async () => {

// 1. Token with features=['nesting'] only → nesting=true, others=false
{
  withState(
    { tier: 'paid', hasPro: true, features: ['nesting'] },
    () => {
      assert(entitlementService.canUse('nesting') === true,
        `paid + features=['nesting']: canUse('nesting') === true`);
      assert(entitlementService.canUse('boolean_ops') === false,
        `paid + features=['nesting']: canUse('boolean_ops') === false`);
      assert(entitlementService.canUse('tabs') === false,
        `paid + features=['nesting']: canUse('tabs') === false`);
    },
  );
}

// 2. Multi-feature token
{
  withState(
    { tier: 'paid', hasPro: true, features: ['nesting', 'boolean_ops'] },
    () => {
      assert(entitlementService.canUse('nesting') === true,
        `multi: canUse('nesting') === true`);
      assert(entitlementService.canUse('boolean_ops') === true,
        `multi: canUse('boolean_ops') === true`);
      assert(entitlementService.canUse('cross_hatch') === false,
        `multi: canUse('cross_hatch') === false`);
    },
  );
}

// 3. Empty features array → ALL features false (even if hasPro=true,
//    because the explicit empty token signals "no features")
{
  withState(
    { tier: 'paid', hasPro: true, features: [] },
    () => {
      for (const f of PRO_FEATURES) {
        assert(entitlementService.canUse(f) === false,
          `empty features array + paid: canUse('${f}') === false`);
      }
    },
  );
}

// 4. Developer tier → all features true regardless of features array
{
  withState(
    { tier: 'developer', hasPro: true, features: [] },
    () => {
      for (const f of PRO_FEATURES) {
        assert(entitlementService.canUse(f) === true,
          `developer wildcard: canUse('${f}') === true`);
      }
    },
  );
}

// 5. tester_permanent tier → all features true regardless of features
{
  withState(
    { tier: 'tester_permanent', hasPro: true, features: [] },
    () => {
      for (const f of PRO_FEATURES) {
        assert(entitlementService.canUse(f) === true,
          `tester_permanent wildcard: canUse('${f}') === true`);
      }
    },
  );
}

// 6. Free tier → all features false
{
  withState(
    { tier: 'free', hasPro: false, features: undefined },
    () => {
      for (const f of PRO_FEATURES) {
        assert(entitlementService.canUse(f) === false,
          `free: canUse('${f}') === false`);
      }
    },
  );
}

// 7. Legacy back-compat: features=undefined + hasPro=true → all true
//    (existing setState paths haven't been migrated to T2-89 tokens)
{
  withState(
    { tier: 'paid', hasPro: true, features: undefined },
    () => {
      for (const f of PRO_FEATURES) {
        assert(entitlementService.canUse(f) === true,
          `legacy paid + features=undefined: canUse('${f}') === true`);
      }
    },
  );
}

// 8. Legacy back-compat: features=undefined + hasPro=false → all false
{
  withState(
    { tier: 'free', hasPro: false, features: undefined },
    () => {
      for (const f of PRO_FEATURES) {
        assert(entitlementService.canUse(f) === false,
          `legacy free + features=undefined: canUse('${f}') === false`);
      }
    },
  );
}

// 9. Trial tier with features array honoured
{
  withState(
    { tier: 'trial', hasPro: true, features: ['nesting'] },
    () => {
      assert(entitlementService.canUse('nesting') === true,
        `trial + features=['nesting']: canUse('nesting') === true`);
      assert(entitlementService.canUse('tabs') === false,
        `trial + features=['nesting']: canUse('tabs') === false`);
    },
  );
}

// 10. Surgical revocation: paid user has features minus boolean_ops
{
  const subset = PRO_FEATURES.filter((f): f is ProFeature => f !== 'boolean_ops');
  withState(
    { tier: 'paid', hasPro: true, features: subset },
    () => {
      assert(entitlementService.canUse('boolean_ops') === false,
        `surgical revocation: canUse('boolean_ops') === false`);
      for (const f of subset) {
        assert(entitlementService.canUse(f) === true,
          `surgical revocation: ${f} retained`);
      }
    },
  );
}

// 11. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..');
  const svc = fs.readFileSync(path.join(repoRoot, 'src/entitlements/EntitlementService.ts'), 'utf-8');
  assert(/T2-92/.test(svc), 'T2-92 marker in EntitlementService.ts');
  assert(/this\.state\.features/.test(svc),
    'canUse consults state.features');
  assert(/state\.tier === ['"]developer['"]/.test(svc),
    'developer wildcard branch present');
  assert(/state\.tier === ['"]tester_permanent['"]/.test(svc),
    'tester_permanent wildcard branch present');
  assert(!/void feature;\s*\n\s*return this\.state\.hasPro/.test(svc),
    `pre-T2-92 'void feature' body removed`);

  const types = fs.readFileSync(path.join(repoRoot, 'src/entitlements/types.ts'), 'utf-8');
  assert(/features\?\s*:\s*ReadonlyArray<ProFeature>/.test(types),
    'EntitlementState.features?: ReadonlyArray<ProFeature> declared');
  assert(/T2-92/.test(types), 'T2-92 marker in types.ts');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
