/**
 * T1-113 follow-up: GitHub Pages deploy workflow exists and remains
 * available on demand without consuming Actions minutes on every push.
 * Source-pin only; we don't run the workflow itself here.
 *
 * Run: npx tsx tests/deploy-pages-workflow.test.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL ${msg}`);
  }
}

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const workflowPath = path.join(repoRoot, '.github/workflows/deploy-pages.yml');

console.log('\n=== T1-113 Pages deploy workflow ===\n');

// 1. Workflow file exists.
assert(fs.existsSync(workflowPath), '.github/workflows/deploy-pages.yml exists');

const src = fs.existsSync(workflowPath) ? fs.readFileSync(workflowPath, 'utf8') : '';

// 2. Manual-only trigger. The May 2026 CI-minute cleanup intentionally
//    stopped automatic Pages builds on every push while preserving an
//    explicit deploy button in GitHub Actions.
{
  assert(/on:\s*[\s\S]*?workflow_dispatch:/.test(src), 'workflow has manual dispatch');

  assert(
    !/\n\s+push:/.test(src) &&
      !/\n\s+pull_request:/.test(src) &&
      !/\n\s+schedule:/.test(src) &&
      !/\n\s+deployment:/.test(src),
    'workflow has no automatic push / PR / schedule / deployment trigger',
  );

  assert(
    /github\.ref\s*==\s*'refs\/heads\/master'/.test(src) &&
      /github\.ref\s*==\s*'refs\/heads\/main'/.test(src),
    'manual deploy is branch-gated to master/main',
  );
}

// 3. Permissions: pages: write + id-token: write.
{
  assert(/pages:\s*write/.test(src), 'permissions: pages: write declared');
  assert(/id-token:\s*write/.test(src), 'permissions: id-token: write declared');
}

// 4. Build steps: npm ci + npm run build + upload dist.
{
  assert(/run:\s*npm ci\b/.test(src), 'workflow runs `npm ci`');
  assert(/run:\s*npm run build\b/.test(src), 'workflow runs `npm run build`');
  assert(
    /actions\/upload-pages-artifact@v3[\s\S]*?path:\s*dist/.test(src),
    'workflow uploads `dist` via actions/upload-pages-artifact@v3',
  );
}

// 5. Deploy step uses actions/deploy-pages@v4 and remains opt-in.
{
  assert(
    /deploy:\s*[\s\S]*?if:\s*\$\{\{[\s\S]*?vars\.ENABLE_GITHUB_PAGES_DEPLOY\s*==\s*'true'[\s\S]*?github\.ref\s*==\s*'refs\/heads\/master'[\s\S]*?github\.ref\s*==\s*'refs\/heads\/main'[\s\S]*?\}\}/.test(src),
    'deploy job is gated by ENABLE_GITHUB_PAGES_DEPLOY and master/main',
  );
  assert(
    /actions\/deploy-pages@v4/.test(src),
    'deploy step uses actions/deploy-pages@v4',
  );
}

// 6. Concurrency group on pages so two rapid manual dispatches do not race.
{
  assert(
    /concurrency:\s*[\s\S]*?group:\s*pages/.test(src),
    'workflow declares a `pages` concurrency group',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
