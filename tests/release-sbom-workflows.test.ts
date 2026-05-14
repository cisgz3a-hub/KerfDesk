/**
 * T1-258: release workflows should upload a Software Bill of Materials
 * beside installer artifacts. T2-103 shipped checksum helpers first;
 * this closes the SBOM part that does not require signing secrets.
 *
 * Run: npx tsx tests/release-sbom-workflows.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ok ${m}`);
  } else {
    failed++;
    console.error(`  fail ${m}`);
  }
}

console.log('\n=== T1-258 release SBOM workflows ===\n');

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'generate-sbom.mjs');
const script = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
const ci = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
const win = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release-windows.yml'), 'utf8');
const mac = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release-macos.yml'), 'utf8');

assert(script.length > 0, 'generate-sbom.mjs exists');
assert(/T1-258/.test(script), 'SBOM generator carries T1-258 marker');
assert(/npm/.test(script) && /sbom/.test(script), 'SBOM generator shells out to npm sbom');
assert(/--omit=dev/.test(script), 'SBOM generator omits dev dependencies');
assert(/--sbom-format=cyclonedx/.test(script), 'SBOM generator emits CycloneDX');
assert(/sbom\.cdx\.json/.test(script), 'SBOM generator writes sbom.cdx.json by default');

for (const [label, workflow, artifactPattern] of [
  ['CI Windows', ci, 'release/\\*\\.exe'],
  ['CI macOS', ci, 'release/\\*\\.dmg'],
  ['signed Windows', win, 'release/\\*\\.exe'],
  ['signed macOS', mac, 'release/\\*\\.dmg'],
] as const) {
  assert(/node scripts\/generate-sbom\.mjs release\/sbom\.cdx\.json/.test(workflow),
    `${label} workflow generates sbom.cdx.json`);
  const uploadRe = new RegExp(`path:\\s*\\|[\\s\\S]*${artifactPattern}[\\s\\S]*release/SHA256SUMS[\\s\\S]*release/sbom\\.cdx\\.json`);
  assert(uploadRe.test(workflow), `${label} workflow uploads installer, SHA256SUMS, and SBOM together`);
}

console.log(`\nT1-258 release SBOM workflows: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
