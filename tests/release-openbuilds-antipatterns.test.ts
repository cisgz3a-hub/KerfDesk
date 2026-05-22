/**
 * LF-EXT-OBC-007: reject OpenBuilds-style release anti-patterns.
 *
 * OpenBuilds CONTROL is a useful packaging comparator, but its release
 * surface also shows patterns LaserForge should not copy: placeholder
 * tests, publish-on-push signed releases, logging certificate material,
 * and broad package globs that can sweep private key/SSL files into
 * installers. This static guard pins LaserForge's opposite contract.
 *
 * Run: npx tsx tests/release-openbuilds-antipatterns.test.ts
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

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

function workflowHasSecretPrinting(workflow: string): boolean {
  return /(?:cat|type|Get-Content)\s+.*(?:CERT|CSC|P12|PFX|KEY|PASSWORD|APPLE|SECRET)/i.test(workflow)
    || /echo\s+\$?\{?\{?\s*(?:secrets|env)\.(?:[^}\s]+)\s*}?}?/i.test(workflow);
}

console.log('\n=== LF-EXT-OBC-007 release anti-pattern guards ===\n');

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const packageJson = JSON.parse(read('package.json')) as {
  scripts?: Record<string, string>;
  build?: { files?: string[] };
};
const winWorkflow = read('.github/workflows/release-windows.yml');
const macWorkflow = read('.github/workflows/release-macos.yml');
const ciWorkflow = read('.github/workflows/ci.yml');
const signingDocs = read('docs/CODE-SIGNING.md');

const testScript = packageJson.scripts?.test ?? '';
assert(testScript === 'node scripts/run-tests.mjs', 'npm test runs the real local test runner');
assert(!/\becho\b.*(no test|todo|placeholder|skip)|exit\s+0/i.test(testScript),
  'npm test is not a placeholder success script');
assert(/run:\s*npm test\b/.test(ciWorkflow), 'default CI runs npm test');
assert(/run:\s*npm run lint\b/.test(ciWorkflow), 'default CI runs lint before release confidence');
assert(/run:\s*npm run build\b/.test(ciWorkflow), 'default CI runs production build');

for (const [label, workflow] of [
  ['Windows signed release', winWorkflow],
  ['macOS signed release', macWorkflow],
] as const) {
  assert(/workflow_dispatch:/.test(workflow), `${label} is manual-dispatch only`);
  assert(!/\n\s+push:/.test(workflow), `${label} does not publish on push/tag events`);
  assert(!/pull_request:/.test(workflow), `${label} is not exposed to pull requests`);
  assert(/publish_release:/.test(workflow), `${label} requires explicit publish_release input`);
  assert(/release_qa_confirmed:/.test(workflow), `${label} requires machine-checkable release QA input`);
  assert(/release_qa_confirmed must be true/i.test(workflow),
    `${label} blocks publishing without QA confirmation`);
  assert(/--publish never/.test(workflow), `${label} electron-builder never auto-publishes`);
  assert(/Generate SHA256 checksums/.test(workflow), `${label} produces checksums`);
  assert(/Generate SBOM/.test(workflow), `${label} produces an SBOM`);
  assert(/actions\/attest@v4/.test(workflow), `${label} produces artifact attestations`);
  assert(!workflowHasSecretPrinting(workflow), `${label} does not print signing secret material`);
}

const packageFiles = packageJson.build?.files ?? [];
assert(packageFiles.includes('dist/**/*'), 'package allowlist includes renderer build output');
assert(packageFiles.includes('dist-electron/**/*'), 'package allowlist includes Electron build output');
assert(packageFiles.includes('package.json'), 'package allowlist includes package metadata');
assert(!packageFiles.some((entry) => entry === '**/*' || entry === '.'),
  'package allowlist does not include repository-wide globs');
assert(!packageFiles.some((entry) => /(?:ssl|cert|secret|private|\.pem|\.p12|\.pfx|\.key)/i.test(entry)),
  'package allowlist does not include certificate/private-key material');

assert(/docs\/INSTALLER-QA\.md/.test(signingDocs), 'code-signing docs link installer QA gate');
assert(/release_qa_confirmed/.test(signingDocs), 'code-signing docs document release QA confirmation');
assert(/gh attestation verify/.test(signingDocs), 'code-signing docs document attestation verification');

console.log(`\nLF-EXT-OBC-007 release anti-pattern guards: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
