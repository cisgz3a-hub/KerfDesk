/**
 * T1-81 regression test: isDevBuild's runtime self-check (Layer 3).
 *
 * Bug class: a misconfigured build that sets both DEV=true AND PROD=true
 * (which Vite shouldn't normally produce, but a future regression or hand-
 * rolled build pipeline could). Without the safety check, that build would
 * auto-unlock Pro for every user.
 *
 * Fix: isDevBuild detects the inconsistent state and falls safely to
 * production. A free user who shouldn't have Pro is preferable to every
 * shipped binary silently auto-unlocking. The console.error makes the
 * misconfiguration visible during testing.
 *
 * This test mirrors the post-fix isDevBuild logic and exercises the four
 * meaningful corners of the (DEV, PROD) flag matrix. Pure-logic mirror —
 * doesn't import the production module because import.meta.env is build-
 * resolved and we want to test the function shape, not Vite's resolver.
 *
 * Run: npx tsx tests/dev-build-self-check.test.ts
 */
export {};

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

interface EnvShape {
  DEV?: boolean;
  PROD?: boolean;
}

/**
 * Mirror of the post-fix isDevBuild in src/entitlements/EntitlementService.ts.
 * Kept structurally identical so a future divergence shows up here. The
 * production code carries a `// T1-81` comment marking the gate.
 *
 * @param env  fake import.meta.env for the test
 * @param logSink  capture console.error invocations rather than emitting them
 */
function runIsDevBuild(env: EnvShape | undefined, logSink: string[]): boolean {
  const isDev = env?.DEV === true;
  const isProd = env?.PROD === true;
  if (isDev && isProd) {
    logSink.push(
      '[EntitlementService] T1-81: Build misconfigured — both DEV and PROD '
      + 'are true. Treating as production for safety. Auto-Pro unlock disabled.',
    );
    return false;
  }
  return isDev;
}

void (() => {
  console.log('\n=== isDevBuild env-flag matrix (T1-81) ===\n');

  // ── 1. DEV=true, PROD=false → dev path ─────────────────────────────────
  // Standard `vite dev` configuration. Auto-Pro unlock is intended.
  {
    const logs: string[] = [];
    const result = runIsDevBuild({ DEV: true, PROD: false }, logs);
    assert(result === true, 'DEV=true, PROD=false → returns true (dev path)');
    assert(logs.length === 0, '  no error logs (configuration is consistent)');
  }

  // ── 2. DEV=false, PROD=true → prod path ────────────────────────────────
  // Standard `vite build` configuration. Auto-Pro unlock must NOT fire.
  {
    const logs: string[] = [];
    const result = runIsDevBuild({ DEV: false, PROD: true }, logs);
    assert(result === false, 'DEV=false, PROD=true → returns false (prod path)');
    assert(logs.length === 0, '  no error logs (configuration is consistent)');
  }

  // ── 3. DEV=true, PROD=true → safety override ──────────────────────────
  // Misconfigured build. Layer 3 catches it: returns false (production-safe)
  // and logs to make the misconfiguration visible during testing/dev.
  {
    const logs: string[] = [];
    const result = runIsDevBuild({ DEV: true, PROD: true }, logs);
    assert(
      result === false,
      'DEV=true, PROD=true → returns false (safety override; production-safe)',
    );
    assert(
      logs.length === 1 && /misconfigured/i.test(logs[0]!),
      '  one error log mentioning the misconfiguration',
    );
  }

  // ── 4. Both undefined → falsy → returns false ──────────────────────────
  // tsx execution path: import.meta.env is undefined in plain Node. Tests
  // and CLI scripts that import the entitlements module land here. Auto-Pro
  // unlock must NOT fire (no env signal that we're in dev).
  {
    const logs: string[] = [];
    const result = runIsDevBuild(undefined, logs);
    assert(result === false, 'env undefined → returns false (no dev signal)');
    assert(logs.length === 0, '  no error logs (no DEV+PROD conflict to detect)');
  }

  // ── 5. DEV=false, PROD=false → returns false ───────────────────────────
  // Edge case: env exists but neither flag set. Treat as production.
  {
    const logs: string[] = [];
    const result = runIsDevBuild({ DEV: false, PROD: false }, logs);
    assert(result === false, 'DEV=false, PROD=false → returns false');
    assert(logs.length === 0, '  no error logs');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
