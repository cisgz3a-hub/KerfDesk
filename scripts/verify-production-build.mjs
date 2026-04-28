/**
 * T1-81 — Layer 1: production bundle verifier.
 * T3-82 — broader pattern library: traps for future regressions that would
 *         leak test-only or debug-only artifacts into the shipped bundle.
 *
 * Walks the dist/ output of `vite build` and rejects bundles that contain
 * forbidden patterns. Wired into `npm run build` so any production build
 * (including the Electron flow that chains through `npm run build`) gets
 * gated automatically. CI inherits the gate because it runs `npm run build`.
 *
 * Forbidden patterns:
 *
 *   tier: 'developer'  — auto-Pro unlock literal
 *     The `if (isDevBuild()) { setState({ tier: 'developer', ... }) }` branches
 *     in src/entitlements/EntitlementService.ts must dead-code-eliminate when
 *     DEV is false. If they don't (misconfigured build, future Vite regression,
 *     etc.), the literal survives in dist/ and every shipped binary auto-
 *     unlocks Pro for every user.
 *
 *   bf5c9e2a-7d41-4c8e-9a1b-laserforge-tester-hmac-v1  — legacy tester secret
 *     Removed in T1-77; this is belt-and-suspenders. If anyone reintroduces
 *     the literal in any source file, this catches it before shipping.
 *
 *   sourceMappingURL=  — runtime source map reference
 *     T2-105 uses Vite's `sourcemap: 'hidden'` mode so renderer .map files
 *     can exist in dist/ for symbolication, but runtime JS/CSS/HTML bundles
 *     must not contain a sourceMappingURL reference that lets end users load
 *     those maps. The .map files themselves are excluded from installers by
 *     package.json:build.files negation globs.
 *
 *   __setTesterHmacSecretForTest  — T1-77's test-only injection point
 *     Defined in src/entitlements/testerKey.ts. Vite tree-shakes it out of
 *     the production bundle today (verified at T3-82 commit time). If a
 *     future change imports it from non-test code (or accidentally re-exports
 *     it from a barrel file that production code touches), it would survive
 *     tree-shaking — and an attacker with DevTools could overwrite the
 *     tester HMAC secret. Rejecting the literal here catches that class of
 *     leak before shipping.
 *
 *   __forceProUnlock, __entitlementService  — speculative debug APIs
 *     Hypothetical names matching the kind of "expose-on-window for
 *     debugging" pattern that's easy to add accidentally and forget about.
 *     No code uses these names today; the verifier rejects them to make
 *     "I'll just expose this on window for now" patterns visible at build
 *     time. If a real ticket ever needs a debug API on window, it should
 *     pick a name not on this list AND document why it's safe to ship.
 *
 *   mockEntitlement, createMockProfile  — speculative test-double leakage
 *     Names that would suggest test-double helpers (an entitlement mock or
 *     a fake user profile) leaking into a production bundle. No code uses
 *     these names today; reject them as a trap for future regressions.
 *
 *   vitest  — test framework reference
 *     We use tsx for tests today, not vitest. If a future ticket adds vitest
 *     and a test-only import accidentally bleeds into a production code path,
 *     the literal survives in the bundle. Rejecting it forces test-framework
 *     code to stay out of the renderer.
 *
 * The script is intentionally pure-Node (no deps); same constraint as the
 * other utility scripts in this folder.
 *
 * Exit codes: 0 success, 1 forbidden pattern found, 2 dist/ missing.
 *
 * Usage: node scripts/verify-production-build.mjs [dist-dir]
 *   defaults dist-dir to ./dist
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = process.argv[2] ?? './dist';

const REJECT_PATTERNS = [
  {
    name: 'auto-Pro unlock literal',
    detail: 'Source: src/entitlements/EntitlementService.ts auto-unlock paths.',
    pattern: /tier:\s*['"]developer['"]/,
  },
  {
    name: 'legacy tester HMAC secret',
    detail: 'Source: T1-77 removed this default. If it appears, someone re-added it.',
    pattern: /bf5c9e2a-7d41-4c8e-9a1b-laserforge-tester-hmac-v1/,
  },
  {
    name: 'tester HMAC test-only injection point',
    detail:
      'Source: src/entitlements/testerKey.ts exports __setTesterHmacSecretForTest '
      + 'for test injection. It must tree-shake out of production. If it survived, '
      + 'an attacker could overwrite the runtime tester secret via DevTools.',
    pattern: /__setTesterHmacSecretForTest/,
  },
  {
    name: 'speculative debug API: __forceProUnlock',
    detail:
      'No code uses this name today. If it appears in dist/, someone added an '
      + '"expose on window for debugging" hook. Either remove it or pick a name '
      + 'that documents why shipping it is safe.',
    pattern: /__forceProUnlock/,
  },
  {
    name: 'speculative debug API: __entitlementService',
    detail:
      'No code uses this name today. If it appears in dist/, someone exposed the '
      + 'entitlement service on a global for debugging. Same fix as __forceProUnlock.',
    pattern: /__entitlementService/,
  },
  {
    name: 'mock entitlement helper leakage',
    detail:
      'Names like mockEntitlement or createMockProfile suggest test doubles in a '
      + 'production code path. Move them to tests/ or rename them to stay out of '
      + 'the renderer bundle.',
    pattern: /\b(?:mockEntitlement|createMockProfile)\b/,
  },
  {
    name: 'test framework leakage (vitest)',
    detail:
      'We use tsx for tests, not vitest. If "vitest" appears in dist/, a test-only '
      + 'import bled into a production code path. Move the import or guard it.',
    pattern: /\bvitest\b/,
  },
];

const SOURCE_MAPPING_URL_PATTERN = /sourceMappingURL\s*=/;

const SCAN_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.map']);

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    const dot = entry.lastIndexOf('.');
    const ext = dot === -1 ? '' : entry.slice(dot);
    if (SCAN_EXTENSIONS.has(ext)) {
      out.push(full);
    }
  }
}

if (!existsSync(DIST)) {
  console.error(`✗ dist directory not found: ${DIST}`);
  console.error('  Did you run `vite build` first?');
  process.exit(2);
}

const files = [];
walk(DIST, files);
console.log(`Scanning ${files.length} file(s) in ${DIST}/ for forbidden patterns...`);

let failed = false;
for (const file of files) {
  // T2-105: hidden sourcemaps deliberately generate .map files in dist/.
  // They are for local/archive tooling only and are excluded from packaged
  // installers. The runtime security property is that non-map files do not
  // reference them via sourceMappingURL (including inline data URI maps).
  if (file.endsWith('.map')) continue;
  const content = readFileSync(file, 'utf8');
  if (SOURCE_MAPPING_URL_PATTERN.test(content)) {
    const match = content.match(SOURCE_MAPPING_URL_PATTERN);
    console.error(
      `\n✗ ${file}\n    contains forbidden source map reference\n    matched: ${match?.[0] ?? '(no preview)'}\n    Set vite.config.ts build.sourcemap to 'hidden' or false; never true or inline for shipped runtime bundles.`,
    );
    failed = true;
  }
  for (const { name, detail, pattern } of REJECT_PATTERNS) {
    if (pattern.test(content)) {
      const match = content.match(pattern);
      console.error(
        `\n✗ ${file}\n    contains forbidden pattern: ${name}\n    matched: ${match?.[0] ?? '(no preview)'}\n    ${detail}`,
      );
      failed = true;
    }
  }
}

if (failed) {
  console.error('\n✗ Production build verification FAILED');
  console.error('  Do not ship this build. Fix the offending source paths and rebuild.');
  process.exit(1);
}
console.log('✓ Production build verification passed');
