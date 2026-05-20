/**
 * F45-17-001: default CI must run the same release-confidence checks that
 * local beta/release verification depends on.
 *
 * Run: npx tsx tests/default-ci-release-confidence.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function extractTestJob(workflow: string): string {
  const start = workflow.search(/\n\s{2}test:\s*\n/);
  if (start < 0) return '';
  const rest = workflow.slice(start + 1);
  const nextJob = rest.search(/\n\s{2}[A-Za-z0-9_-]+:\s*\n/);
  return nextJob < 0 ? rest : rest.slice(0, nextJob);
}

console.log('\n=== F45-17-001 default CI release-confidence checks ===\n');

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const scripts = packageJson.scripts ?? {};
const testJob = extractTestJob(workflow);

assert(scripts.typecheck === 'tsc --noEmit --pretty false', 'package.json exposes npm run typecheck');
assert(scripts.lint === 'eslint . --max-warnings 0', 'package.json exposes npm run lint');
assert(/pull_request:/.test(workflow), 'CI still runs on pull requests');
assert(/\n\s+push:\s*[\s\S]*branches:\s*\[\s*master,\s*main\s*\]/.test(workflow), 'CI still runs on master/main pushes');
assert(/run:\s*npm ci\b/.test(testJob), 'default test job installs dependencies');
assert(/run:\s*npm audit --omit=dev --audit-level=moderate\b/.test(testJob), 'default test job audits production dependencies');
assert(/run:\s*npm run typecheck\b/.test(testJob), 'default test job runs typecheck');
assert(/run:\s*npm run lint\b/.test(testJob), 'default test job runs lint');
assert(/run:\s*npm run electron:compile\b/.test(testJob), 'default test job compiles Electron main/preload code');
assert(/run:\s*npm run project-map:check\b/.test(testJob), 'default test job checks generated project map freshness');
assert(/run:\s*npm run build\b/.test(testJob), 'default test job still runs production build verification');
assert(/run:\s*npm test\b/.test(testJob), 'default test job still runs the full test suite');
assert(
  testJob.indexOf('npm run typecheck') < testJob.indexOf('npm run build'),
  'typecheck runs before production build',
);
assert(
  testJob.indexOf('npm run lint') < testJob.indexOf('npm test'),
  'lint runs before full tests',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
