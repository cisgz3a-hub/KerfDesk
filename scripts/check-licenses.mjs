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
// Scope note (audit M34/H11): this gate covers npm PACKAGES only. Vendored
// source (e.g. the in-house potrace port, see AUDIT-2026-06-10 H11) is
// structurally outside any package-license scan and requires source
// provenance review — a green run here must not be cited as clearing it.

import { execSync } from 'node:child_process';

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
  '(MPL-2.0 OR Apache-2.0)',
  'CC-BY-4.0',
  'CC0-1.0',
  'Python-2.0',
]);

const raw = execSync('pnpm licenses list --prod --json', {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  // pnpm is a .cmd shim on Windows; a shell resolves it on every platform.
  shell: true,
});

/** @type {Record<string, ReadonlyArray<{ name: string, versions?: string[] }>>} */
const byLicense = JSON.parse(raw);

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

if (violations.length > 0) {
  console.error('license-check: disallowed licenses in the production dependency tree:');
  for (const line of violations) console.error(line);
  console.error('Allowed list lives in scripts/check-licenses.mjs (ADR-008 / ADR-017).');
  process.exit(1);
}

console.log(
  `license-check: ${packageCount} production package(s) across ` +
    `${Object.keys(byLicense).length} license(s) — all allowed.`,
);
