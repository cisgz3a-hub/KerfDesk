/**
 * T2-99: signed Windows release workflow stays separate from unsigned PR builds.
 *
 * Run: npx tsx tests/windows-signing-release-workflow.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  fail ${message}`);
  }
}

console.log('\n=== T2-99 Windows signed release workflow ===\n');

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release-windows.yml'), 'utf8');
const signedConfig = fs.readFileSync(path.join(repoRoot, 'scripts', 'signing', 'electron-builder.windows-signed.cjs'), 'utf8');
const ci = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

assert(/on:\s*[\s\S]*?workflow_dispatch:/.test(workflow), 'signed workflow has manual dispatch');
assert(!/\n\s+push:/.test(workflow), 'signed workflow does not run automatically for version tags');
assert(!/pull_request/.test(workflow), 'signed workflow is not exposed to pull requests');
assert(/runs-on:\s+windows-latest/.test(workflow), 'signed workflow uses a Windows runner');
assert(/CSC_LINK:\s*\$\{\{\s*secrets\.WIN_CERT_PFX_BASE64\s*\}\}/.test(workflow), 'workflow reads certificate from WIN_CERT_PFX_BASE64 secret');
assert(/CSC_KEY_PASSWORD:\s*\$\{\{\s*secrets\.WIN_CERT_PASSWORD\s*\}\}/.test(workflow), 'workflow reads certificate password from WIN_CERT_PASSWORD secret');
assert(/Verify signing secrets/.test(workflow), 'workflow fails early when signing secrets are missing');
assert(/electron-builder --win --config scripts\/signing\/electron-builder\.windows-signed\.cjs --publish never/.test(workflow), 'workflow uses the signed electron-builder config');
assert(/node scripts\/generate-checksums\.mjs release/.test(workflow), 'workflow generates SHA256SUMS for signed Windows artifact');
assert(/windows-signed-installer/.test(workflow), 'workflow uploads a signed installer artifact');
assert(/path:\s*\|\s*[\s\S]*release\/\*\.exe[\s\S]*release\/SHA256SUMS/.test(workflow),
  'workflow uploads signed exe together with SHA256SUMS');

assert(/require\('\.\.\/\.\.\/package\.json'\)\.build/.test(signedConfig), 'signed config extends package build config');
assert(/signAndEditExecutable:\s*true/.test(signedConfig), 'signed config enables executable signing');
assert(/publisherName:\s*'LaserForge'/.test(signedConfig), 'signed config pins publisher name');
assert(/signingHashAlgorithms:\s*\[\s*'sha256'\s*\]/.test(signedConfig), 'signed config pins sha256 signing');

assert(!/WIN_CERT_PFX_BASE64/.test(ci), 'PR CI does not expose Windows certificate secret');
assert(!/WIN_CERT_PASSWORD/.test(ci), 'PR CI does not expose Windows certificate password');
assert(/signAndEditExecutable": false/.test(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')), 'default package build remains unsigned for PR builds');

console.log(`\nT2-99 Windows signed release workflow: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
