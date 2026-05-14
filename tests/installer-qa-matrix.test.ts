/**
 * T3-85: release installer QA matrix.
 *
 * The installer QA process is intentionally manual, but it still needs
 * to be repo-owned and regression-pinned. This test keeps the release
 * checklist from silently dropping platform scenarios that the audit
 * called out as required before a paid/public release.
 *
 * Run: npx tsx tests/installer-qa-matrix.test.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  fail ${message}`);
  }
}

function includesAll(haystack: string, needles: readonly string[]): boolean {
  return needles.every((needle) => haystack.includes(needle));
}

console.log('\n=== T3-85 installer QA matrix ===\n');

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const qaPath = path.join(repoRoot, 'docs', 'INSTALLER-QA.md');
const signingPath = path.join(repoRoot, 'docs', 'CODE-SIGNING.md');

const qa = fs.existsSync(qaPath) ? fs.readFileSync(qaPath, 'utf8') : '';
const signing = fs.readFileSync(signingPath, 'utf8');

assert(fs.existsSync(qaPath), 'docs/INSTALLER-QA.md exists');
assert(/# Installer QA/.test(qa), 'installer QA doc has the expected title');
assert(/T3-85/.test(qa), 'installer QA doc carries the T3-85 marker');
assert(/manual release gate/i.test(qa), 'installer QA doc names the checklist as a manual release gate');
assert(/Release candidate record/.test(qa), 'installer QA doc includes a release candidate record section');
assert(includesAll(qa, [
  'Version',
  'Commit',
  'Windows artifact',
  'macOS artifact',
  'SHA256SUMS',
  'SBOM',
  'Attestation',
]), 'release candidate record captures artifact identity and integrity data');

for (const scenario of [
  'Windows 10 fresh install, admin user',
  'Windows 11 fresh install, admin user',
  'Windows 11 fresh install, non-admin user',
  'Windows 11 upgrade install over previous version',
  'Windows 11 uninstall / reinstall',
  'Windows path with spaces',
  'Windows path with non-ASCII characters',
  'macOS Intel fresh install',
  'macOS Apple Silicon fresh install',
  'macOS Gatekeeper before notarization',
  'macOS Gatekeeper after notarization',
  'Offline during install',
  'App launches without internet',
] as const) {
  assert(qa.includes(scenario), `QA matrix includes: ${scenario}`);
}

assert(/Result/.test(qa) && /Pass/.test(qa) && /Fail/.test(qa) && /Blocked/.test(qa),
  'QA matrix records Pass/Fail/Blocked result states');
assert(/Do not publish/i.test(qa), 'QA doc contains a no-publish rule for failed required rows');
assert(/restricted user/i.test(qa), 'QA doc preserves restricted-user coverage language');
assert(/unicode path/i.test(qa), 'QA doc preserves unicode-path coverage language');
assert(/offline/i.test(qa), 'QA doc preserves offline install and launch coverage language');
assert(/docs\/CODE-SIGNING\.md/.test(qa), 'QA doc points back to code-signing instructions');
assert(/docs\/INSTALLER-QA\.md/.test(signing), 'CODE-SIGNING docs link to the installer QA checklist');

console.log(`\nT3-85 installer QA matrix: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
