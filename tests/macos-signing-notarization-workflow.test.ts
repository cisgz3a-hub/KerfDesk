/**
 * T2-100: signed and notarized macOS release workflow stays manual-only.
 *
 * Run: npx tsx tests/macos-signing-notarization-workflow.test.ts
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

console.log('\n=== T2-100 macOS signing and notarization workflow ===\n');

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release-macos.yml'), 'utf8');
const signedConfig = fs.readFileSync(path.join(repoRoot, 'scripts', 'signing', 'electron-builder.macos-signed.cjs'), 'utf8');
const entitlements = fs.readFileSync(path.join(repoRoot, 'scripts', 'signing', 'entitlements.mac.plist'), 'utf8');
const ci = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

assert(/on:\s*[\s\S]*?workflow_dispatch:/.test(workflow), 'signed workflow has manual dispatch');
assert(!/\n\s+push:/.test(workflow), 'signed workflow does not run automatically for version tags');
assert(!/pull_request/.test(workflow), 'signed workflow is not exposed to pull requests');
assert(/runs-on:\s+macos-latest/.test(workflow), 'signed workflow uses a macOS runner');
assert(/CSC_LINK:\s*\$\{\{\s*secrets\.MAC_CERT_P12_BASE64\s*\}\}/.test(workflow), 'workflow reads certificate from MAC_CERT_P12_BASE64 secret');
assert(/CSC_KEY_PASSWORD:\s*\$\{\{\s*secrets\.MAC_CERT_PASSWORD\s*\}\}/.test(workflow), 'workflow reads certificate password from MAC_CERT_PASSWORD secret');
assert(/APPLE_ID:\s*\$\{\{\s*secrets\.APPLE_ID\s*\}\}/.test(workflow), 'workflow reads APPLE_ID secret');
assert(/APPLE_APP_SPECIFIC_PASSWORD:\s*\$\{\{\s*secrets\.APPLE_APP_SPECIFIC_PASSWORD\s*\}\}/.test(workflow), 'workflow reads app-specific password secret');
assert(/APPLE_TEAM_ID:\s*\$\{\{\s*secrets\.APPLE_TEAM_ID\s*\}\}/.test(workflow), 'workflow reads APPLE_TEAM_ID secret');
assert(/Verify signing and notarization secrets/.test(workflow), 'workflow fails early when release secrets are missing');
assert(/electron-builder --mac --config scripts\/signing\/electron-builder\.macos-signed\.cjs --publish never/.test(workflow), 'workflow uses the signed macOS electron-builder config');
assert(/node scripts\/generate-checksums\.mjs release/.test(workflow), 'workflow generates SHA256SUMS for signed macOS artifact');
assert(/macos-signed-notarized-dmg/.test(workflow), 'workflow uploads notarized dmg artifact');
assert(/path:\s*\|\s*[\s\S]*release\/\*\.dmg[\s\S]*release\/SHA256SUMS/.test(workflow),
  'workflow uploads notarized dmg together with SHA256SUMS');

assert(/require\('\.\.\/\.\.\/package\.json'\)\.build/.test(signedConfig), 'signed config extends package build config');
assert(/hardenedRuntime:\s*true/.test(signedConfig), 'signed config enables hardened runtime');
assert(/gatekeeperAssess:\s*false/.test(signedConfig), 'signed config disables local Gatekeeper assess during build');
assert(/entitlements:\s*'scripts\/signing\/entitlements\.mac\.plist'/.test(signedConfig), 'signed config pins entitlements file');
assert(/entitlementsInherit:\s*'scripts\/signing\/entitlements\.mac\.plist'/.test(signedConfig), 'signed config pins inherited entitlements file');
assert(/notarize:\s*\{[\s\S]*teamId:\s*process\.env\.APPLE_TEAM_ID/.test(signedConfig), 'signed config enables notarization with APPLE_TEAM_ID');
assert(/identity:\s*process\.env\.MAC_SIGNING_IDENTITY \|\| undefined/.test(signedConfig), 'signed config supports explicit signing identity override');

assert(/com\.apple\.security\.cs\.allow-jit/.test(entitlements), 'entitlements allow Chromium JIT');
assert(/com\.apple\.security\.cs\.allow-unsigned-executable-memory/.test(entitlements), 'entitlements allow Electron executable memory');

assert(!/MAC_CERT_P12_BASE64/.test(ci), 'PR CI does not expose macOS certificate secret');
assert(!/APPLE_APP_SPECIFIC_PASSWORD/.test(ci), 'PR CI does not expose notarization password');
assert(/CSC_IDENTITY_AUTO_DISCOVERY:\s+false/.test(ci), 'PR macOS installer build remains unsigned');

console.log(`\nT2-100 macOS signing and notarization workflow: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
