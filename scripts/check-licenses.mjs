// check-licenses — pnpm-aware production dependency license gate (ADR-008 /
// ADR-017; audit M34).
//
// The previous gate (license-checker@25) cannot traverse pnpm's symlinked
// node_modules layout, so it inspected exactly the 6 DIRECT dependencies and
// certified nothing about the installed transitive production tree — a
// future GPL transitive dep would have sailed through. `pnpm licenses list`
// reads pnpm's own lockfile-resolved store, so every installed production
// package is covered.
//
// Scope note: this gate covers npm PACKAGES only. First-party/vendored
// source is structurally outside any package-license scan and requires
// separate provenance review — a green run here must not be cited as
// clearing it.
//
// Development dependencies the build bundles into the shipped app (the Workbox
// service-worker runtime, the PWA register hook, the desktop MCP view's client)
// are not in the --prod closure, so the gate also checks the pinned
// BUNDLED_BUILD_PACKAGES from the development inventory (ADR-017 Amendment 3).
//
// Every new allowlist entry requires an ADR-017 and RESEARCH_LOG review. Font
// and Creative Commons asset licenses are reviewed outside this npm-package
// gate and must not be added here merely because a bundled asset uses them.

import { execSync } from 'node:child_process';
import path from 'node:path';

import { BUNDLED_BUILD_PACKAGES, REPO_ROOT } from './third-party-closure.mjs';

const ALLOWED_LICENSES = new Set([
  'MIT',
  'MIT-0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BSL-1.0',
  'Apache-2.0',
  'Apache-2.0 AND MIT',
  'MPL-2.0',
  'ISC',
  'Unlicense',
  '0BSD',
  // Permissive, MIT-compatible (Blue Oak Council permissive list; SPDX-recognized;
  // no copyleft). Pulled transitively by electron-updater → builder-util-runtime →
  // sax@1.6.0 (ADR-024). Maintainer-approved 2026-07-04.
  'BlueOak-1.0.0',
  '(MPL-2.0 OR Apache-2.0)',
  'Python-2.0',
  // Approved by ADR-017 policy 2 (pako review in ADR-591).
  'Zlib',
  // ag-psd -> pako: both permissive constituents reviewed in ADR-591.
  '(MIT AND Zlib)',
]);

function inventory(scope) {
  const raw = execSync(`pnpm licenses list ${scope} --json`, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // pnpm is a .cmd shim on Windows; a shell resolves it on every platform.
    shell: true,
  });
  /** @type {Record<string, ReadonlyArray<{ name: string, versions?: string[] }>>} */
  return JSON.parse(raw);
}

const byLicense = inventory('--prod');

let packageCount = 0;
const violations = [];
for (const [license, packages] of Object.entries(byLicense)) {
  packageCount += packages.length;
  if (ALLOWED_LICENSES.has(license)) continue;
  for (const pkg of packages) {
    violations.push(`  ${pkg.name}@${(pkg.versions ?? []).join(', ')} — ${license}`);
  }
}

if (packageCount === 0) {
  console.error('license-check: pnpm reported ZERO production packages — refusing to pass.');
  process.exit(1);
}

// The bundled development packages belong to the root app only; the phone
// service runs this gate from its own folder for its own closure.
let bundledCount = 0;
if (path.resolve(process.cwd()) === REPO_ROOT) {
  const wanted = new Set(BUNDLED_BUILD_PACKAGES.map(({ name }) => name));
  const seen = new Set();
  for (const [license, packages] of Object.entries(inventory('--dev'))) {
    for (const pkg of packages) {
      if (!wanted.has(pkg.name)) continue;
      seen.add(pkg.name);
      bundledCount += 1;
      if (ALLOWED_LICENSES.has(license)) continue;
      violations.push(`  ${pkg.name}@${(pkg.versions ?? []).join(', ')} — ${license} (bundled)`);
    }
  }
  for (const name of wanted) {
    if (!seen.has(name)) violations.push(`  ${name} — bundled build package not installed`);
  }
}

if (violations.length > 0) {
  console.error('license-check: disallowed licenses in the production dependency tree:');
  for (const line of violations) console.error(line);
  console.error('Allowed list lives in scripts/check-licenses.mjs (ADR-008 / ADR-017).');
  process.exit(1);
}

console.log(
  `license-check: ${packageCount} production package(s) across ` +
    `${Object.keys(byLicense).length} license(s)` +
    (bundledCount > 0 ? ` and ${bundledCount} bundled build package(s)` : '') +
    ' — all allowed.',
);
