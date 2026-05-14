/**
 * T1-259: signed release workflows should publish GitHub artifact
 * attestations for installer provenance and the installer SBOM.
 *
 * Run: npx tsx tests/release-artifact-attestations.test.ts
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

console.log('\n=== T1-259 signed release artifact attestations ===\n');

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const win = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release-windows.yml'), 'utf8');
const mac = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release-macos.yml'), 'utf8');
const docs = fs.readFileSync(path.join(repoRoot, 'docs', 'CODE-SIGNING.md'), 'utf8');

for (const [label, workflow, artifactPattern] of [
  ['Windows', win, 'release/\\*\\.exe'],
  ['macOS', mac, 'release/\\*\\.dmg'],
] as const) {
  assert(/permissions:\s*[\s\S]*contents:\s+(read|write)/.test(workflow),
    `${label} workflow declares contents permission`);
  assert(/permissions:\s*[\s\S]*id-token:\s+write/.test(workflow),
    `${label} workflow declares id-token: write permission for Sigstore signing`);
  assert(/permissions:\s*[\s\S]*attestations:\s+write/.test(workflow),
    `${label} workflow declares attestations: write permission`);

  const provenanceRe = new RegExp(`Generate ${label} installer provenance attestation[\\s\\S]*uses:\\s+actions/attest@v4[\\s\\S]*subject-path:\\s+'${artifactPattern}'`);
  assert(provenanceRe.test(workflow),
    `${label} workflow attests installer provenance with actions/attest@v4`);

  const sbomRe = new RegExp(`Generate ${label} installer SBOM attestation[\\s\\S]*uses:\\s+actions/attest@v4[\\s\\S]*subject-path:\\s+'${artifactPattern}'[\\s\\S]*sbom-path:\\s+'release/sbom\\.cdx\\.json'`);
  assert(sbomRe.test(workflow),
    `${label} workflow attests sbom.cdx.json against the installer`);
}

assert(/gh attestation verify/.test(docs), 'CODE-SIGNING docs include gh attestation verification');
assert(/sbom\.cdx\.json/.test(docs), 'CODE-SIGNING docs mention SBOM attestation artifact');
assert(/T1-259/.test(docs), 'CODE-SIGNING docs carry T1-259 marker');

console.log(`\nT1-259 signed release artifact attestations: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
