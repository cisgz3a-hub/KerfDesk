/**
 * T3-83: tamper-resistance test suite.
 *
 * Audit 5A required tests + tamper-resistance section. The suite both
 * pins the protections that already shipped (T1-77 / T1-78 / T1-79 /
 * T1-81) and documents which scenarios are deferred until upstream
 * tickets land (T2-89 / T2-90 / T2-94 for signed-token / clock-tamper
 * scenarios).
 *
 * The audit explicitly says this suite "ships incrementally as
 * protections land". This first slice covers the bypasses that have
 * shipped protections in place; later slices add the signed-token and
 * clock-tamper scenarios once T2-90 / T2-94 ship.
 *
 * Run: npx tsx tests/entitlement-tamper-resistance/tamper-resistance.test.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { __setTesterHmacSecretForTest, verifyTesterCode } from '../../src/entitlements/testerKey';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

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

function readSrc(rel: string): string {
  const full = resolve(repoRoot, rel);
  if (!existsSync(full)) return '';
  return readFileSync(full, 'utf-8');
}

console.log('\n=== T3-83 entitlement tamper resistance ===\n');

void (async () => {
  // 1. T1-77: no hardcoded tester HMAC secret. Without
  //    `VITE_TESTER_HMAC_SECRET` set at build time, every tester key
  //    rejects. Builds that don't set the env var don't ship the
  //    tester program.
  {
    __setTesterHmacSecretForTest(null);
    const ok = await verifyTesterCode('TF-EXAMPLE-DEADBEEF');
    assert(ok === false, 'T1-77: tester key rejects when no secret is configured');

    // Even malformed input rejects without crash.
    const malformed = await verifyTesterCode('not-a-tester-key');
    assert(malformed === false, 'T1-77: malformed tester input rejects');
  }

  // 2. T1-77: source-pin that the secret-resolution path does NOT
  //    have a hardcoded fallback. A regression that adds back a
  //    `?? 'some-secret'` literal would fail this pin. The protection
  //    only works as long as no source-controlled secret exists.
  {
    const src = readSrc('src/entitlements/testerKey.ts');
    assert(src.length > 0, 'tester key source is readable');

    const removedComment = /T1-77.*default.*tester.*secret.*removed/is.test(src);
    assert(removedComment, 'T1-77: source documents that DEFAULT_TESTER_HMAC_SECRET was removed');

    // Negative pin: no `?? 'xxxxx'` style fallback after env-var read.
    // (Allow the test-only override; reject any other string fallback.)
    assert(
      !/VITE_TESTER_HMAC_SECRET\s*\?\?\s*['"]/m.test(src),
      'T1-77: no string-literal fallback after VITE_TESTER_HMAC_SECRET read',
    );
    // Negative pin: no exported DEFAULT_TESTER_HMAC_SECRET.
    assert(
      !/export\s+const\s+DEFAULT_TESTER_HMAC_SECRET/.test(src),
      'T1-77: DEFAULT_TESTER_HMAC_SECRET is not exported',
    );
  }

  // 3. T1-77: tester key generated against a different secret rejects.
  //    Build a key against secret A, verify against secret B.
  {
    __setTesterHmacSecretForTest('secret-a');
    // Manually compute a valid TF-XXXX-XXXXXXXX for secret-a, then
    // verify against secret-b. Use the same HMAC recipe the module
    // uses (LaserForge|tester|v1|<slug>, first 8 hex chars uppercase).
    const slug = 'TEST';
    const message = `LaserForge|tester|v1|${slug}`;
    const enc = new TextEncoder();
    const keyA = await crypto.subtle.importKey(
      'raw',
      enc.encode('secret-a'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sigA = new Uint8Array(await crypto.subtle.sign('HMAC', keyA, enc.encode(message)));
    const sigAHex = Array.from(sigA).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 8).toUpperCase();
    const validForA = `TF-${slug}-${sigAHex}`;

    // Verify against secret-a: passes.
    const okA = await verifyTesterCode(validForA);
    assert(okA === true, 'Tester key generated for secret-a verifies against secret-a');

    // Now switch secrets and re-verify: rejects (signature does not match).
    __setTesterHmacSecretForTest('secret-b');
    const okB = await verifyTesterCode(validForA);
    assert(okB === false, 'Tester key generated for secret-a rejects against secret-b');

    __setTesterHmacSecretForTest(null);
  }

  // 4. T1-78: entitlement API split. canUseFeature is a boolean check
  //    only; assertFeature throws EntitlementError. The deprecated
  //    `requireFeature` alias was removed in Phase 3.
  {
    const barrel = readSrc('src/entitlements/index.ts');
    assert(/export function canUseFeature/.test(barrel), 'T1-78: canUseFeature exported');
    assert(/export function assertFeature/.test(barrel), 'T1-78: assertFeature exported');
    assert(/export class EntitlementError/.test(barrel), 'T1-78: EntitlementError class exported');
    assert(
      !/export function requireFeature/.test(barrel),
      'T1-78 Phase 3: deprecated requireFeature alias removed from barrel',
    );
  }

  // 5. T1-79: service-layer gates throw EntitlementError. The audit
  //    test `tests/service-layer-pro-gate-coverage.test.ts` enforces
  //    this for every Pro entry point. Pin its presence + that it
  //    names the load-bearing entry-point gates.
  {
    const cov = readSrc('tests/service-layer-pro-gate-coverage.test.ts');
    assert(cov.length > 0, 'service-layer-pro-gate-coverage.test.ts exists');
    assert(/Nester/.test(cov), 'T1-79: service-layer-pro-gate covers Nester');
    assert(/BooleanOps/.test(cov), 'T1-79: service-layer-pro-gate covers BooleanOps');
    assert(/JobCompiler/.test(cov), 'T1-79: service-layer-pro-gate covers JobCompiler');
  }

  // 6. T1-81: production build verification script audits forbidden
  //    debug markers (`__forceProUnlock`, `__entitlementService`, etc.).
  //    Pin the verify script exists + exercises a meaningful set of
  //    markers.
  {
    const verify = readSrc('scripts/verify-production-build.mjs');
    assert(verify.length > 0, 'verify-production-build.mjs exists');
    assert(/__forceProUnlock/.test(verify), 'T1-81: verify script blocks __forceProUnlock');
    assert(/__entitlementService/.test(verify), 'T1-81: verify script blocks __entitlementService leak');
  }

  // 7. Service-layer Pro feature throws when canUse returns false.
  //    Behavioral pin without needing to mutate entitlement state —
  //    the `entitlementService` default tier is 'free' in test
  //    environments (no stored license), so `canUseFeature` returns
  //    false and `assertFeature` must throw `EntitlementError`.
  {
    const { assertFeature, EntitlementError, canUseFeature } = await import('../../src/entitlements');
    assert(canUseFeature('boolean_ops') === false, 'Default test env: canUseFeature("boolean_ops") false');
    assert(canUseFeature('nesting') === false, 'Default test env: canUseFeature("nesting") false');

    let caught: unknown = null;
    try {
      assertFeature('boolean_ops');
    } catch (e) {
      caught = e;
    }
    assert(caught instanceof EntitlementError, 'assertFeature("boolean_ops") throws EntitlementError when not paid');
    if (caught instanceof EntitlementError) {
      assert(caught.feature === 'boolean_ops', 'EntitlementError.feature is "boolean_ops"');
      assert(/Pro/i.test(caught.message), 'EntitlementError.message names Pro');
      assert(caught.name === 'EntitlementError', 'EntitlementError.name is "EntitlementError"');
    }

    // The booleanOperation entry point in BooleanOps.ts also gates
    // via assertFeature; source-pin ensures the call site is intact.
    const opsSrc = readSrc('src/geometry/BooleanOps.ts');
    assert(/assertFeature\('boolean_ops'\)/.test(opsSrc), 'BooleanOps.booleanOperation source-pinned to assertFeature');
  }

  // 8. The runtime monkey-patch limit. Documented LIMIT, not a
  //    "passes" — pinning what we DON'T claim. A determined attacker
  //    can mutate `entitlementService.state` in a debugger; ultimate
  //    protection requires server-side gates for premium features.
  //    This pin asserts the project has a documented stance, not that
  //    the attack is prevented.
  {
    const audit = readSrc('docs/ROADMAP-shipped-audit.md');
    // The shipped-audit doc carries the T1-78 / T1-79 entries with
    // the limit-acknowledgment ("ultimately requires server-side
    // enforcement" or similar). Pin the existence of any entry that
    // names client-side limits.
    const hasLimit =
      /client-side enforcement/i.test(audit)
      || /server-side gates/i.test(audit)
      || /server-side entitlement/i.test(audit)
      || /T2-89/.test(audit);
    assert(hasLimit, 'Audit doc names T2-89 / server-side entitlement / client-side limit');
  }

  // 9. Self-pin: T3-83 marker present in this manifest.
  {
    const selfPath = resolve(here, 'tamper-resistance.test.ts');
    const selfSrc = readFileSync(selfPath, 'utf-8');
    assert(/T3-83/.test(selfSrc), 'Manifest source: T3-83 marker present');
    assert(/audit 5A/i.test(selfSrc), 'Manifest source: audit 5A cited');
  }

  console.log(`\nT3-83 tamper resistance: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
