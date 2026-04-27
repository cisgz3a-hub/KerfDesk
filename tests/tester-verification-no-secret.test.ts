/**
 * T1-77 regression test: verifyTesterCode must refuse all tester codes when
 * no HMAC secret is configured.
 *
 * Bug: the previous DEFAULT_TESTER_HMAC_SECRET fallback meant any client
 * build without VITE_TESTER_HMAC_SECRET set still verified tester keys
 * against a hardcoded literal. Anyone could read the bundle, extract the
 * secret, and generate unlimited valid keys via scripts/generate-tester-key.mjs.
 *
 * Fix: removed the default. With no env var set and no test override, the
 * resolver returns null and verifyTesterCode returns false unconditionally.
 * Internal/QA builds set VITE_TESTER_HMAC_SECRET; production end-user builds
 * don't (and shouldn't, since the tester program isn't an end-user feature).
 *
 * Run: npx tsx tests/tester-verification-no-secret.test.ts
 */
export {};

import {
  verifyTesterCode,
  parseTesterCode,
  TESTER_KEY_MESSAGE_PREFIX,
  __setTesterHmacSecretForTest,
} from '../src/entitlements/testerKey';

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

/** Synthesize a valid tester code for a given secret + slug. */
async function synthesize(secret: string, slug: string): Promise<string> {
  const message = `${TESTER_KEY_MESSAGE_PREFIX}${slug.toUpperCase()}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 8)
    .toUpperCase();
  return `TF-${slug.toUpperCase()}-${hex}`;
}

void (async () => {
  console.log('\n=== tester verification — no secret configured (T1-77) ===\n');

  // Ensure clean starting state.
  __setTesterHmacSecretForTest(null);

  // ── 1. No override + no env → all codes reject ─────────────────────────
  // Under tsx, import.meta.env is undefined (no VITE build pipeline), so
  // the resolver falls through to null. This mirrors a production build
  // where VITE_TESTER_HMAC_SECRET wasn't set.
  {
    // Even a syntactically-valid code with the right shape:
    const valid = await synthesize('any-secret', 'TESTER');
    assert(
      parseTesterCode(valid) !== null,
      'sanity: synthesized code parses as well-formed',
    );
    const result = await verifyTesterCode(valid);
    assert(
      result === false,
      'no secret configured → verifyTesterCode returns false even for well-formed input',
    );
  }

  // ── 2. With override set → matching code verifies ──────────────────────
  // Proves the override path is functional and that the resolver does
  // consult the override when set. Production never sets this, but tests
  // (entitlement-storage-migration.test.ts) rely on it.
  {
    const TEST_SECRET = 'test-only-secret-for-no-secret-test';
    __setTesterHmacSecretForTest(TEST_SECRET);
    const code = await synthesize(TEST_SECRET, 'OVERRIDE');
    const result = await verifyTesterCode(code);
    assert(
      result === true,
      'override set + matching code → verifyTesterCode returns true',
    );
  }

  // ── 3. Override set, but code signed with DIFFERENT secret → false ────
  // Proves we're actually verifying the signature, not just gating on
  // "is any secret installed".
  {
    const TEST_SECRET = 'test-only-secret-for-no-secret-test';
    __setTesterHmacSecretForTest(TEST_SECRET);
    const wrongSecretCode = await synthesize('different-secret', 'WRONG');
    const result = await verifyTesterCode(wrongSecretCode);
    assert(
      result === false,
      'override set + code signed with different secret → false',
    );
  }

  // ── 4. After clearing override → all codes reject again ────────────────
  {
    const TEST_SECRET = 'test-only-secret-for-no-secret-test';
    __setTesterHmacSecretForTest(TEST_SECRET);
    const code = await synthesize(TEST_SECRET, 'CLEARED');
    // Sanity: would verify with override still set.
    assert(await verifyTesterCode(code) === true, 'sanity: code verifies with override set');

    __setTesterHmacSecretForTest(null);
    const result = await verifyTesterCode(code);
    assert(
      result === false,
      'after clearing override → verifyTesterCode rejects (no secret configured again)',
    );
  }

  // ── 5. Malformed code with override set → still rejects via parser ────
  // The parser-level rejection still fires even when secret is configured;
  // verifies the no-secret early return doesn't change parser semantics.
  {
    __setTesterHmacSecretForTest('any-secret');
    const result = await verifyTesterCode('not-a-tester-code-at-all');
    assert(
      result === false,
      'malformed code → false even with override set (parser still rejects)',
    );
  }

  // Final cleanup so subsequent tests in the runner see no leaked state.
  __setTesterHmacSecretForTest(null);

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  __setTesterHmacSecretForTest(null);
  console.error(err);
  process.exit(1);
});
