/**
 * T1-260: signed release workflows should be able to publish signed
 * installer artifacts to a GitHub Release when explicitly requested.
 *
 * Run: npx tsx tests/release-github-publish-workflows.test.ts
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

console.log('\n=== T1-260 signed release GitHub publishing ===\n');

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const win = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release-windows.yml'), 'utf8');
const mac = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release-macos.yml'), 'utf8');
const docs = fs.readFileSync(path.join(repoRoot, 'docs', 'CODE-SIGNING.md'), 'utf8');

for (const [label, workflow, platform, extension] of [
  ['Windows', win, 'windows', 'exe'],
  ['macOS', mac, 'macos', 'dmg'],
] as const) {
  assert(/workflow_dispatch:\s*[\s\S]*inputs:\s*[\s\S]*publish_release:/.test(workflow),
    `${label} workflow exposes a publish_release manual input`);
  assert(/workflow_dispatch:\s*[\s\S]*inputs:\s*[\s\S]*release_tag:/.test(workflow),
    `${label} workflow exposes a release_tag manual input`);
  assert(/workflow_dispatch:\s*[\s\S]*inputs:\s*[\s\S]*release_qa_confirmed:/.test(workflow),
    `${label} workflow exposes a release_qa_confirmed manual input`);
  assert(/contents:\s+write/.test(workflow),
    `${label} workflow grants contents: write only for explicit release publishing`);
  assert(/Validate GitHub Release publish input/.test(workflow),
    `${label} workflow validates release_tag before publishing`);
  assert(/RELEASE_QA_CONFIRMED/.test(workflow),
    `${label} workflow machine-checks release QA confirmation before publishing`);
  assert(new RegExp(`SHA256SUMS\\.${platform}`).test(workflow),
    `${label} workflow copies platform-specific checksum filename`);
  assert(new RegExp(`sbom\\.${platform}\\.cdx\\.json`).test(workflow),
    `${label} workflow copies platform-specific SBOM filename`);
  assert(/if:\s*\$\{\{\s*inputs\.publish_release\s*\}\}/.test(workflow),
    `${label} publish steps are gated behind publish_release`);
  assert(/gh release view/.test(workflow) && /gh release create/.test(workflow),
    `${label} workflow creates a draft release only when needed`);
  if (platform === 'windows') {
    assert(/gh release upload[\s\S]*release\/LaserForge-Setup-\*\.exe[\s\S]*release\/\*\.blockmap[\s\S]*release\/latest\.yml[\s\S]*release\/SHA256SUMS\.windows[\s\S]*release\/sbom\.windows\.cdx\.json/.test(workflow),
      'Windows workflow uploads installer, updater metadata, platform checksum, and platform SBOM');
    assert(/gh release edit[^\n]*--draft=false/.test(workflow),
      'Windows workflow publishes the release after updater metadata upload');
  } else {
    assert(new RegExp(`gh release upload[\\s\\S]*release/\\*\\.${extension}[\\s\\S]*release/SHA256SUMS\\.${platform}[\\s\\S]*release/sbom\\.${platform}\\.cdx\\.json`).test(workflow),
      `${label} workflow uploads installer, platform checksum, and platform SBOM`);
  }
  assert(/GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/.test(workflow),
    `${label} workflow uses the GitHub token for gh release commands`);
}

assert(/publish_release/.test(docs), 'CODE-SIGNING docs mention the publish_release switch');
assert(/release_tag/.test(docs), 'CODE-SIGNING docs mention the release_tag input');
assert(/release_qa_confirmed/.test(docs), 'CODE-SIGNING docs mention the release_qa_confirmed gate');
assert(/SHA256SUMS\.windows/.test(docs) && /SHA256SUMS\.macos/.test(docs),
  'CODE-SIGNING docs document platform-specific checksum assets');
assert(/latest\.yml/.test(docs) && /\.blockmap/.test(docs),
  'CODE-SIGNING docs document Windows updater metadata assets');
assert(/T1-260/.test(docs), 'CODE-SIGNING docs carry T1-260 marker');

console.log(`\nT1-260 signed release GitHub publishing: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
