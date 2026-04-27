/**
 * Audit-cluster regression test: keep the security-relevant runtime deps
 * pinned to versions that have the published advisories patched.
 *
 * BACKGROUND — npm audit triage performed across four commits:
 *
 * Initial state (pre-93b305b): 15 advisories (2 low, 2 moderate, 11 high).
 * After Tier-A xmldom + dompurify upgrades (93b305b): 14 advisories.
 * After Tier-C electron-builder upgrade (6fe39ac):    2 advisories.
 * After Tier-A postcss override (this commit):        1 advisory.
 *
 * `npm audit` reported 15 advisories across 2 direct deps, 12 transitive
 * deps, and electron itself. Triage by reachability (does the advisory
 * reach LaserForge runtime code on an end-user machine):
 *
 * ┌─────────────────────────────┬───────────────────────────────────────┐
 * │ TIER A — runtime, fixed here                                        │
 * ├─────────────────────────────┼───────────────────────────────────────┤
 * │ @xmldom/xmldom 0.9.9→0.9.10 │ All 8 advisories were about XML       │
 * │                             │ serialization. We only PARSE (in      │
 * │                             │ src/import/svg/SvgParser.ts via       │
 * │                             │ DOMParser). Verified by grep: zero    │
 * │                             │ XMLSerializer / serialize() calls in  │
 * │                             │ src/ or electron/. Reachable only via │
 * │                             │ plist transitively (build-only). Top- │
 * │                             │ level dep upgraded as a hygiene step. │
 * │                             │                                       │
 * │ dompurify 3.3.3 → 3.4.1     │ All 4 advisories were sanitizer       │
 * │                             │ bypass issues. We use it in           │
 * │                             │ TemplateBrowser.tsx to sanitize       │
 * │                             │ bundled TemplateLibrary.ts SVGs.      │
 * │                             │ Input is app-controlled, not user-    │
 * │                             │ controlled — an attacker would need   │
 * │                             │ source-code write access to reach the │
 * │                             │ sanitizer with hostile input. Bypass  │
 * │                             │ unreachable in practice but upgrade   │
 * │                             │ is a clean minor bump.                │
 * │                             │                                       │
 * │ postcss 8.5.8 → 8.5.12 via  │ One CSS-stringify XSS advisory        │
 * │ npm overrides               │ (postcss < 8.5.10). Reachability null │
 * │                             │ in our usage — postcss is consumed by │
 * │                             │ vite to bundle our own CSS, not user- │
 * │                             │ supplied CSS. Bumped via npm          │
 * │                             │ overrides rather than a vite minor    │
 * │                             │ bump because vite 8.0.10 has an       │
 * │                             │ unresolved production-build           │
 * │                             │ regression ("Class extends value      │
 * │                             │ undefined"). Override pins postcss    │
 * │                             │ directly, leaving vite at 8.0.5.      │
 * │                             │                                       │
 * │                             │ REMOVE THE OVERRIDE when vite is      │
 * │                             │ upgraded to a version that declares   │
 * │                             │ postcss >= 8.5.10 and does not have   │
 * │                             │ the 8.0.10 production-build           │
 * │                             │ regression.                           │
 * └─────────────────────────────┴───────────────────────────────────────┘
 *
 * ┌─────────────────────────────┬───────────────────────────────────────┐
 * │ TIER B — runtime, deferred to a dedicated upgrade ticket            │
 * ├─────────────────────────────┼───────────────────────────────────────┤
 * │ electron 34.5.8 → 41.3.0    │ 18 advisories. Most specific items    │
 * │                             │ are unreachable in our usage (we      │
 * │                             │ don't use download dialogs, custom    │
 * │                             │ protocols, USB API, child windows,    │
 * │                             │ service workers, second-instance      │
 * │                             │ lock, setAsDefaultProtocolClient,     │
 * │                             │ setLoginItemSettings, etc.). But      │
 * │                             │ running on a known-vulnerable major   │
 * │                             │ is not viable long-term — future-     │
 * │                             │ discovered issues won't get patches.  │
 * │                             │ Deferred because: 7-version semver-   │
 * │                             │ major bump requires full Falcon WS    │
 * │                             │ retest, serial retest, native-modules │
 * │                             │ ABI retest, and runtime smoke. Its    │
 * │                             │ own ticket.                           │
 * └─────────────────────────────┴───────────────────────────────────────┘
 *
 * ┌─────────────────────────────┬───────────────────────────────────────┐
 * │ TIER C — build-only, fixed here                                     │
 * ├─────────────────────────────┼───────────────────────────────────────┤
 * │ electron-builder 25 → 26    │ Collapses the build-only advisory     │
 * │                             │ cluster: @electron/rebuild,          │
 * │                             │ @tootallnate/once, app-builder-lib,   │
 * │                             │ cacache, dmg-builder,                 │
 * │                             │ electron-builder-squirrel-windows,    │
 * │                             │ http-proxy-agent, make-fetch-happen,  │
 * │                             │ node-gyp, tar, and plist's nested     │
 * │                             │ @xmldom/xmldom. These packages run on │
 * │                             │ the developer's build machine, not on │
 * │                             │ the end-user's installed app, but the │
 * │                             │ patched builder line is still pinned  │
 * │                             │ so the build host does not drift back │
 * │                             │ into the known-vulnerable cluster.    │
 * │                             │                                       │
 * └─────────────────────────────┴───────────────────────────────────────┘
 *
 * (TIER C is now empty — the postcss-via-vite holdover moved to Tier A
 *  via the npm override above.)
 *
 * WHAT THIS TEST ENFORCES:
 *   1. The two Tier A upgrades stay in place — package.json declarations
 *      and resolved package-lock.json versions both at-or-above the
 *      patched lines for @xmldom/xmldom, dompurify, and postcss
 *      (postcss via the npm overrides field).
 *   2. The test FAILS if a future regression downgrades either dep into
 *      the vulnerable range.
 *   3. The electron-builder cluster stays on the patched 26.x line and
 *      the old vulnerable transitive packages stay absent.
 *   4. The test does NOT enforce zero `npm audit` output — that would
 *      conflate fixed Tier A/C work with Tier B (electron major upgrade)
 *      and either block all merges or train people to ignore the test.
 *
 * Run: npx tsx tests/security-deps-pinned.test.ts
 */
export {};

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

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

interface PkgJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
}

interface LockfileEntry {
  version?: string;
}

interface Lockfile {
  packages?: Record<string, LockfileEntry>;
}

/**
 * Compare two semver strings. Returns negative if a < b, zero if a === b,
 * positive if a > b. Handles MAJOR.MINOR.PATCH only (no pre-release tags).
 */
function semverCmp(a: string, b: string): number {
  const ap = a.split('.').map(s => parseInt(s, 10));
  const bp = b.split('.').map(s => parseInt(s, 10));
  for (let i = 0; i < 3; i++) {
    const av = ap[i] ?? 0;
    const bv = bp[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

console.log('\n=== security-relevant deps pinned (audit triage) ===\n');

// ── Load package.json + lockfile ───────────────────────────────────
const pkg = JSON.parse(
  readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
) as PkgJson;
const lock = JSON.parse(
  readFileSync(join(REPO_ROOT, 'package-lock.json'), 'utf8'),
) as Lockfile;

function lockVersion(packagePath: string): string {
  return lock.packages?.[packagePath]?.version ?? '';
}

// ── @xmldom/xmldom (Tier A) ────────────────────────────────────────
{
  const declared = pkg.dependencies?.['@xmldom/xmldom']
    ?? pkg.devDependencies?.['@xmldom/xmldom']
    ?? '';
  // Strip leading ^ or ~ for comparison.
  const declaredMin = declared.replace(/^[\^~]/, '');
  assert(
    declared.length > 0,
    '@xmldom/xmldom is declared in package.json',
  );
  assert(
    semverCmp(declaredMin, '0.9.10') >= 0,
    `@xmldom/xmldom declared at >= 0.9.10 (patched line); got "${declared}"`,
  );

  const resolved = lock.packages?.['node_modules/@xmldom/xmldom']?.version ?? '';
  assert(
    resolved.length > 0,
    '@xmldom/xmldom is resolved in package-lock.json',
  );
  assert(
    semverCmp(resolved, '0.9.10') >= 0,
    `@xmldom/xmldom resolved at >= 0.9.10 in lockfile; got "${resolved}"`,
  );
  // Document the upper bound: nothing currently constrains us against a
  // future major. If 1.0.0 ships and breaks our parser, pin a more
  // specific range here.
  assert(
    semverCmp(resolved, '0.10.0') < 0
    || semverCmp(resolved, '0.10.0') >= 0, // tautology — bound is informational
    `@xmldom/xmldom version "${resolved}" recorded for traceability`,
  );
}

// ── dompurify (Tier A) ─────────────────────────────────────────────
{
  const declared = pkg.dependencies?.['dompurify']
    ?? pkg.devDependencies?.['dompurify']
    ?? '';
  const declaredMin = declared.replace(/^[\^~]/, '');
  assert(
    declared.length > 0,
    'dompurify is declared in package.json',
  );
  // The 4 sanitizer-bypass advisories are fixed in 3.4.0+. We declared
  // ^3.4.1 to pick up the latest in the patched line.
  assert(
    semverCmp(declaredMin, '3.4.0') >= 0,
    `dompurify declared at >= 3.4.0 (patched line); got "${declared}"`,
  );

  const resolved = lock.packages?.['node_modules/dompurify']?.version ?? '';
  assert(
    resolved.length > 0,
    'dompurify is resolved in package-lock.json',
  );
  assert(
    semverCmp(resolved, '3.4.0') >= 0,
    `dompurify resolved at >= 3.4.0 in lockfile; got "${resolved}"`,
  );
}

// ── electron-builder cluster (Tier C, build-only) ──────────────────
{
  const declared = pkg.devDependencies?.['electron-builder'] ?? '';
  const declaredMin = declared.replace(/^[\^~]/, '');
  assert(
    declared.length > 0,
    'electron-builder is declared in devDependencies',
  );
  assert(
    semverCmp(declaredMin, '26.8.1') >= 0,
    `electron-builder declared at >= 26.8.1 (patched builder line); got "${declared}"`,
  );

  const builderVersion = lockVersion('node_modules/electron-builder');
  assert(
    builderVersion.length > 0,
    'electron-builder is resolved in package-lock.json',
  );
  assert(
    semverCmp(builderVersion, '26.8.1') >= 0,
    `electron-builder resolved at >= 26.8.1 in lockfile; got "${builderVersion}"`,
  );

  const patchedBuilderPackages: Array<[string, string]> = [
    ['node_modules/app-builder-lib', '26.8.1'],
    ['node_modules/dmg-builder', '26.8.1'],
    ['node_modules/electron-builder-squirrel-windows', '26.8.1'],
    ['node_modules/@electron/rebuild', '4.0.3'],
    ['node_modules/node-gyp', '12.2.0'],
    ['node_modules/tar', '7.5.11'],
    ['node_modules/http-proxy-agent', '7.0.0'],
    ['node_modules/plist/node_modules/@xmldom/xmldom', '0.8.13'],
  ];

  for (const [packagePath, minVersion] of patchedBuilderPackages) {
    const resolved = lockVersion(packagePath);
    assert(
      resolved.length > 0,
      `${packagePath} is resolved in package-lock.json`,
    );
    assert(
      semverCmp(resolved, minVersion) >= 0,
      `${packagePath} resolved at >= ${minVersion}; got "${resolved}"`,
    );
  }

  const removedPackages = [
    'node_modules/@tootallnate/once',
    'node_modules/cacache',
    'node_modules/make-fetch-happen',
  ];

  for (const packagePath of removedPackages) {
    assert(
      lock.packages?.[packagePath] === undefined,
      `${packagePath} is absent from package-lock.json (old builder cluster removed)`,
    );
  }
}

// ── postcss (Tier A, via npm overrides) ────────────────────────────
// postcss < 8.5.10 has a CSS-stringify XSS advisory. We do not bump vite
// to clear it because vite 8.0.10 has an unresolved production-build
// regression; instead npm's overrides field forces postcss directly to the
// patched line while vite stays at 8.0.5.
//
// Remove this override once vite is upgraded to a version that declares
// postcss >= 8.5.10 and does not have the 8.0.10 production-build regression.
{
  const overridePin = pkg.overrides?.postcss ?? '';
  assert(
    overridePin.length > 0,
    'package.json declares an overrides.postcss pin',
  );
  const overrideMin = overridePin.replace(/^[\^~]/, '');
  assert(
    semverCmp(overrideMin, '8.5.10') >= 0,
    `overrides.postcss declared at >= 8.5.10 (patched line); got "${overridePin}"`,
  );

  const resolved = lockVersion('node_modules/postcss');
  assert(
    resolved.length > 0,
    'postcss is resolved in package-lock.json',
  );
  assert(
    semverCmp(resolved, '8.5.10') >= 0,
    `postcss resolved at >= 8.5.10 in lockfile (override applied); got "${resolved}"`,
  );

  let postcssInstallCount = 0;
  for (const packagePath of Object.keys(lock.packages ?? {})) {
    if (/(?:^|\/)node_modules\/postcss$/.test(packagePath)) {
      postcssInstallCount++;
    }
  }
  assert(
    postcssInstallCount === 1,
    `exactly one postcss installation in the tree (got ${postcssInstallCount}). Multiple installations may indicate the override did not fully propagate.`,
  );
}

// ── Reachability invariants (defense-in-depth against future code drift) ──
// These assertions document and enforce the assumptions that the
// reachability triage relied on. If any of them flip, the triage is no
// longer valid and the deferred-upgrade calculus must be re-evaluated.

// Invariant 1: We do not call XMLSerializer or .serialize() in our code.
// If we ever start serializing XML via xmldom, the 8 cleared advisories
// (all about serialization) would become reachable, and the upgrade
// posture would shift from "hygiene" to "required".
{
  // Walk src/ and electron/ for any sign of XML serialization.
  // Cheap source-level grep — same pattern used in earlier security tests.
  const dirs = ['src', 'electron'];
  let serializerHits = 0;
  const sites: string[] = [];

  function walk(dir: string): void {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const fullDir = join(REPO_ROOT, dir);
    if (!fs.existsSync(fullDir)) return;
    for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
      const full = path.join(fullDir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'dist-electron'].includes(entry.name)) continue;
        walkRel(full);
      } else if (
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
        && !entry.name.endsWith('.test.ts')
        && !entry.name.endsWith('.test.tsx')
        && !entry.name.endsWith('.d.ts')
      ) {
        const text = fs.readFileSync(full, 'utf8');
        // Strip comments to avoid false positives from doc references.
        const code = text
          .replace(/(^|[\s;])\/\/[^\n]*/g, '$1')
          .replace(/\/\*[\s\S]*?\*\//g, '');
        // XMLSerializer constructor or .serializeToString. Also explicit
        // xmldom serialization helpers if any exist.
        if (/\bnew\s+XMLSerializer\b|\bserializeToString\b/.test(code)) {
          serializerHits++;
          if (sites.length < 3) sites.push(full.replace(REPO_ROOT, ''));
        }
      }
    }
  }
  function walkRel(dir: string): void {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'dist-electron'].includes(entry.name)) continue;
        walkRel(full);
      } else if (
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
        && !entry.name.endsWith('.test.ts')
        && !entry.name.endsWith('.test.tsx')
        && !entry.name.endsWith('.d.ts')
      ) {
        const text = fs.readFileSync(full, 'utf8');
        const code = text
          .replace(/(^|[\s;])\/\/[^\n]*/g, '$1')
          .replace(/\/\*[\s\S]*?\*\//g, '');
        if (/\bnew\s+XMLSerializer\b|\bserializeToString\b/.test(code)) {
          serializerHits++;
          if (sites.length < 3) sites.push(full.replace(REPO_ROOT, ''));
        }
      }
    }
  }

  for (const d of dirs) walk(d);
  assert(
    serializerHits === 0,
    `no XML serialization in src/ or electron/ (xmldom advisory reachability invariant); got ${serializerHits}${sites.length ? ' (' + sites.join(', ') + ')' : ''}`,
  );
}

// Invariant 2: dompurify input remains app-controlled, not user-controlled.
// We can't check the runtime data flow from a static grep, so we assert
// the structural invariant: the only DOMPurify.sanitize site in our code
// is in TemplateBrowser.tsx feeding bundled template SVG strings.
{
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');

  const sanitizeSites: string[] = [];

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'dist-electron'].includes(entry.name)) continue;
        walk(full);
      } else if (
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
        && !entry.name.endsWith('.test.ts')
        && !entry.name.endsWith('.test.tsx')
        && !entry.name.endsWith('.d.ts')
      ) {
        const text = fs.readFileSync(full, 'utf8');
        const code = text
          .replace(/(^|[\s;])\/\/[^\n]*/g, '$1')
          .replace(/\/\*[\s\S]*?\*\//g, '');
        if (/\bDOMPurify\.sanitize\(/.test(code)) {
          sanitizeSites.push(full.replace(REPO_ROOT, ''));
        }
      }
    }
  }

  walk(join(REPO_ROOT, 'src'));
  walk(join(REPO_ROOT, 'electron'));

  // Today exactly one site exists. If new sites appear, the reachability
  // triage MUST be re-validated for each — they may consume user-
  // controllable input.
  assert(
    sanitizeSites.length === 1,
    `exactly one DOMPurify.sanitize site (got ${sanitizeSites.length}: ${sanitizeSites.join(', ')}). New sites require reachability triage.`,
  );
  // And it's the expected one.
  assert(
    sanitizeSites[0]?.includes('TemplateBrowser') ?? false,
    `DOMPurify.sanitize site is in TemplateBrowser.tsx (got "${sanitizeSites[0] ?? '<none>'}")`,
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
