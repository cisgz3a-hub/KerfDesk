/**
 * T1-81 — Layer 1: production bundle verifier.
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
];

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
// T1-83: source-map files must not appear in the renderer dist/. The Electron
// main-process maps live in dist-electron/ and are excluded at the packaging
// step via package.json:build.files negation globs (dist-electron glob with
// a later !*.map exclusion). This check covers the renderer side: if Vite
// ever starts emitting maps (config drift, version regression, opt-in for
// crash reporting that wasn't switched to 'hidden'), the build is rejected
// before we ship it.
const mapFiles = files.filter(f => f.endsWith('.map'));
for (const file of mapFiles) {
  console.error(
    `\n✗ ${file}\n    source map file present in renderer bundle\n    Set vite.config.ts build.sourcemap to false (or 'hidden' for crash-reporter use).`,
  );
  failed = true;
}

for (const file of files) {
  if (file.endsWith('.map')) continue; // already reported above
  const content = readFileSync(file, 'utf8');
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
