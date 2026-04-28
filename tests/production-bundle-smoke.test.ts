/**
 * T1-81 regression test: scripts/verify-production-build.mjs correctly
 * detects forbidden patterns in synthetic dist/ content.
 *
 * Bug class: a misconfigured production build that ships dev-mode auto-Pro
 * unlock (`tier: 'developer'`) or the legacy tester HMAC secret
 * (`bf5c9e2a-...`, removed in T1-77). Layer 1 of T1-81 is a build-time grep
 * over dist/ that rejects any bundle containing these patterns.
 *
 * T3-82 broadens the pattern list with traps for future regressions:
 * tester-injection points (__setTesterHmacSecretForTest), speculative
 * debug APIs (__forceProUnlock, __entitlementService), test-double helper
 * names (mockEntitlement, createMockProfile), and test framework leakage
 * (vitest).
 *
 * This test exercises the verifier script's logic against synthetic dist
 * directories — it doesn't actually run `vite build`. The reasoning: CI
 * already runs `npm run build` against the real source on every PR, so
 * production-bundle coverage comes for free. This test's job is to prove
 * the script's logic is right (catches forbidden patterns when present,
 * lets clean output through).
 *
 * Core cases:
 *   1. Empty dist/ → exit 0
 *   2. Clean dist with safe code → exit 0
 *   3. dist with `tier: 'developer'` → exit 1
 *   4. dist with the legacy tester secret literal → exit 1
 *   5. T2-105 hidden sourcemaps: .map files may exist, but runtime files
 *      must not contain sourceMappingURL references.
 *   6. T3-82 broader pattern library: tester injection point, debug-API
 *      shapes, test-double names, vitest reference.
 *
 * Run: npx tsx tests/production-bundle-smoke.test.ts
 */
export {};

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const VERIFY_SCRIPT = join(REPO_ROOT, 'scripts', 'verify-production-build.mjs');

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

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runVerifier(distDir: string): RunResult {
  const result = spawnSync('node', [VERIFY_SCRIPT, distDir], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

interface FakeDist {
  dir: string;
  cleanup: () => void;
}

function makeFakeDist(files: Record<string, string>): FakeDist {
  const dir = mkdtempSync(join(tmpdir(), 'lf-verify-'));
  const distDir = join(dir, 'dist');
  mkdirSync(distDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const full = join(distDir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return {
    dir: distDir,
    cleanup: () => { rmSync(dir, { recursive: true, force: true }); },
  };
}

void (() => {
  console.log('\n=== verify-production-build.mjs smoke (T1-81) ===\n');

  // ── 1. Empty dist/ → exit 0 ────────────────────────────────────────────
  {
    const fake = makeFakeDist({});
    try {
      const r = runVerifier(fake.dir);
      assert(r.exitCode === 0, 'empty dist/ → exit 0');
      assert(
        /verification passed/i.test(r.stdout),
        '  stdout reports verification passed',
      );
    } finally {
      fake.cleanup();
    }
  }

  // ── 2. Clean dist with safe code → exit 0 ──────────────────────────────
  {
    const fake = makeFakeDist({
      'index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
      'assets/index-abc123.js': `
        console.log("hello");
        const tier = "free";
        function isDevBuild() { return false; }
        // case 'developer': in source still appears in consumer code paths
        // but this regex doesn't match it (no tier: prefix).
        switch (tier) {
          case 'developer': break;
          case 'free': break;
        }
      `,
      'assets/style.css': '.foo { color: red; }',
    });
    try {
      const r = runVerifier(fake.dir);
      assert(r.exitCode === 0, 'clean dist → exit 0');
      assert(
        /verification passed/i.test(r.stdout),
        '  stdout reports verification passed',
      );
      assert(
        !/forbidden/i.test(r.stderr),
        '  no forbidden-pattern messages in stderr',
      );
    } finally {
      fake.cleanup();
    }
  }

  // ── 3. dist containing the auto-Pro unlock literal → exit 1 ───────────
  {
    const fake = makeFakeDist({
      'assets/leak.js': `
        function init() {
          setState({ tier: 'developer', hasPro: true });
        }
      `,
    });
    try {
      const r = runVerifier(fake.dir);
      assert(r.exitCode === 1, 'auto-Pro unlock literal in dist → exit 1');
      assert(
        /forbidden pattern/i.test(r.stderr),
        '  stderr reports the forbidden pattern',
      );
      assert(
        /auto-Pro unlock/i.test(r.stderr),
        '  stderr names the specific pattern (auto-Pro unlock)',
      );
      assert(
        /verification FAILED/i.test(r.stderr),
        '  stderr ends with FAILED message',
      );
    } finally {
      fake.cleanup();
    }
  }

  // ── 4. dist containing the legacy tester secret literal → exit 1 ──────
  {
    const fake = makeFakeDist({
      'assets/leak.js':
        'const SECRET = "bf5c9e2a-7d41-4c8e-9a1b-laserforge-tester-hmac-v1";',
    });
    try {
      const r = runVerifier(fake.dir);
      assert(r.exitCode === 1, 'legacy tester secret in dist → exit 1');
      assert(
        /forbidden pattern/i.test(r.stderr),
        '  stderr reports the forbidden pattern',
      );
      assert(
        /tester HMAC secret/i.test(r.stderr),
        '  stderr names the specific pattern (tester HMAC secret)',
      );
    } finally {
      fake.cleanup();
    }
  }

  // ── 5. Different quote styles around 'developer' both detected ────────
  // The regex /tier:\s*['"]developer['"]/ matches both ' and ". Verify both.
  {
    const fake = makeFakeDist({
      'assets/leak.js': "var s = { tier:\"developer\", hasPro:true };",
    });
    try {
      const r = runVerifier(fake.dir);
      assert(r.exitCode === 1, 'double-quote variant also detected');
    } finally {
      fake.cleanup();
    }
  }

  // ── 6. Missing dist directory → exit 2 ────────────────────────────────
  {
    const r = runVerifier('/tmp/__nonexistent-laserforge-dist__');
    assert(r.exitCode === 2, 'missing dist → exit 2');
    assert(
      /not found/i.test(r.stderr),
      '  stderr explains the dist is missing',
    );
  }

  // ── 7. T2-105: hidden .map file with no runtime URL reference passes ───
  // Hidden sourcemaps are generated for symbolication/archive tooling, then
  // excluded from packaged installers. The runtime bundle must not point at
  // them with sourceMappingURL.
  {
    const fake = makeFakeDist({
      'assets/index-abc123.js': 'console.log("hello");',
      'assets/index-abc123.js.map': '{"version":3,"sources":["../src/main.ts"]}',
    });
    try {
      const r = runVerifier(fake.dir);
      assert(r.exitCode === 0, 'T2-105: hidden .map file in dist/ with no URL reference → exit 0');
      assert(
        /verification passed/i.test(r.stdout),
        '  stdout reports verification passed',
      );
    } finally {
      fake.cleanup();
    }
  }

  // ── 8. T2-105: external sourceMappingURL reference is rejected ─────────
  {
    const fake = makeFakeDist({
      'index.js': 'console.log("ok");\n//# sourceMappingURL=index.js.map',
      'index.js.map': '{"version":3}',
    });
    try {
      const r = runVerifier(fake.dir);
      assert(r.exitCode === 1, 'external sourceMappingURL reference in runtime JS → exit 1');
      assert(
        /source map reference/i.test(r.stderr),
        '  stderr names source map reference in the rejection message',
      );
    } finally {
      fake.cleanup();
    }
  }

  // ── 9. T2-105: inline sourceMappingURL data URI is rejected ────────────
  // The old ".map file exists" heuristic missed inline maps because they
  // don't create a separate .map file. The new verifier catches the real leak.
  {
    const fake = makeFakeDist({
      'assets/index.js': 'console.log("ok");\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==',
    });
    try {
      const r = runVerifier(fake.dir);
      assert(r.exitCode === 1, 'inline sourceMappingURL data URI in runtime JS → exit 1');
      assert(
        /source map reference/i.test(r.stderr),
        '  stderr names source map reference for inline maps',
      );
    } finally {
      fake.cleanup();
    }
  }

  // ── 10. T2-105: .map.bak is inert if not referenced ───────────────────
  {
    const fake = makeFakeDist({
      'assets/index.js': 'console.log("ok");',
      'assets/index.js.map.bak': '{"version":3}', // backup file, not a map
    });
    try {
      const r = runVerifier(fake.dir);
      assert(r.exitCode === 0, '.map.bak passes (last extension is .bak)');
    } finally {
      fake.cleanup();
    }
  }

  // ── 11. T3-82: tester injection point in dist → exit 1 ────────────────
  // src/entitlements/testerKey.ts exports __setTesterHmacSecretForTest as a
  // test injection point. Vite tree-shakes it out today; if it ever
  // survives (e.g., a future ticket imports it from non-test code, or a
  // barrel re-export pulls it into a production path), the verifier
  // catches it at build time.
  {
    const fake = makeFakeDist({
      'assets/leak.js':
        'export function __setTesterHmacSecretForTest(s) { CURRENT_SECRET = s; }',
    });
    try {
      const r = runVerifier(fake.dir);
      assert(
        r.exitCode === 1,
        'T3-82: __setTesterHmacSecretForTest in dist → exit 1',
      );
      assert(
        /tester HMAC test-only injection/i.test(r.stderr),
        '  stderr names the tester injection-point pattern',
      );
    } finally {
      fake.cleanup();
    }
  }

  // ── 12. T3-82: speculative __forceProUnlock debug API → exit 1 ────────
  {
    const fake = makeFakeDist({
      'assets/leak.js': 'window.__forceProUnlock = () => state.tier = "pro";',
    });
    try {
      const r = runVerifier(fake.dir);
      assert(r.exitCode === 1, 'T3-82: __forceProUnlock in dist → exit 1');
      assert(
        /__forceProUnlock/.test(r.stderr),
        '  stderr names the __forceProUnlock pattern',
      );
    } finally {
      fake.cleanup();
    }
  }

  // ── 13. T3-82: speculative __entitlementService debug exposure → exit 1
  {
    const fake = makeFakeDist({
      'assets/leak.js': 'window.__entitlementService = entitlementService;',
    });
    try {
      const r = runVerifier(fake.dir);
      assert(r.exitCode === 1, 'T3-82: __entitlementService in dist → exit 1');
      assert(
        /__entitlementService/.test(r.stderr),
        '  stderr names the __entitlementService pattern',
      );
    } finally {
      fake.cleanup();
    }
  }

  // ── 14. T3-82: mock-entitlement helper leakage → exit 1 ───────────────
  {
    const fake = makeFakeDist({
      'assets/leak.js':
        'function mockEntitlement(opts) { return { tier: opts.tier }; }',
    });
    try {
      const r = runVerifier(fake.dir);
      assert(r.exitCode === 1, 'T3-82: mockEntitlement in dist → exit 1');
      assert(
        /mock entitlement helper/i.test(r.stderr),
        '  stderr names the mock-entitlement pattern',
      );
    } finally {
      fake.cleanup();
    }
  }

  // ── 15. T3-82: createMockProfile (alternate test-double name) → exit 1
  {
    const fake = makeFakeDist({
      'assets/leak.js':
        'export function createMockProfile() { return { user: "test" }; }',
    });
    try {
      const r = runVerifier(fake.dir);
      assert(r.exitCode === 1, 'T3-82: createMockProfile in dist → exit 1');
      assert(
        /mock entitlement helper/i.test(r.stderr),
        '  stderr names the mock-entitlement pattern',
      );
    } finally {
      fake.cleanup();
    }
  }

  // ── 16. T3-82: vitest reference → exit 1 ──────────────────────────────
  {
    const fake = makeFakeDist({
      'assets/leak.js': 'import { describe } from "vitest";',
    });
    try {
      const r = runVerifier(fake.dir);
      assert(r.exitCode === 1, 'T3-82: vitest reference in dist → exit 1');
      assert(
        /test framework leakage \(vitest\)/i.test(r.stderr),
        '  stderr names the vitest pattern',
      );
    } finally {
      fake.cleanup();
    }
  }

  // ── 17. T3-82: word-boundary discipline ───────────────────────────────
  // The vitest pattern uses \b to avoid matching it as a substring of an
  // unrelated identifier. Confirm a bigger word containing "vitest" passes.
  {
    const fake = makeFakeDist({
      'assets/clean.js': 'const InvitestProgress = 0;',
    });
    try {
      const r = runVerifier(fake.dir);
      assert(
        r.exitCode === 0,
        'T3-82: "Invitest" substring (no word boundary) → exit 0',
      );
    } finally {
      fake.cleanup();
    }
  }

  // ── 18. T3-82: a dist with multiple T3-82 leaks reports all of them ───
  // A later test can fix multiple regressions at once, so the verifier
  // should report each pattern that fires (not bail on the first).
  {
    const fake = makeFakeDist({
      'assets/leak.js':
        'window.__forceProUnlock = 1; function mockEntitlement(){}',
    });
    try {
      const r = runVerifier(fake.dir);
      assert(
        r.exitCode === 1,
        'T3-82: dist with multiple leaks → exit 1',
      );
      assert(
        /__forceProUnlock/.test(r.stderr) && /mock entitlement/i.test(r.stderr),
        '  stderr reports both patterns (not just the first)',
      );
    } finally {
      fake.cleanup();
    }
  }

  // ── 19. T3-82: a comment mentioning a forbidden literal still rejects ──
  // The verifier doesn't try to be smart about what's "really" forbidden vs
  // mentioned in a comment — comments in production source code are
  // suspicious anyway (why would __forceProUnlock be discussed in shipped
  // code?). Force callers to remove the literal, not annotate it away.
  {
    const fake = makeFakeDist({
      'assets/leak.js':
        '// historical: had __forceProUnlock here for debug, removed\nfunction main(){}',
    });
    try {
      const r = runVerifier(fake.dir);
      assert(
        r.exitCode === 1,
        'T3-82: forbidden literal in a comment also rejects (no comment carve-outs)',
      );
    } finally {
      fake.cleanup();
    }
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
