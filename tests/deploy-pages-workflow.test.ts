/**
 * T1-113: GitHub Pages auto-deploy workflow exists and is wired
 * correctly. Source-pin only — we don't run the workflow itself
 * here; that happens in GitHub Actions on push to master.
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
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const workflowPath = path.join(repoRoot, '.github/workflows/deploy-pages.yml');

console.log('\n=== T1-113 Pages auto-deploy workflow ===\n');

// 1. Workflow file exists
assert(fs.existsSync(workflowPath), '.github/workflows/deploy-pages.yml exists');

const src = fs.existsSync(workflowPath) ? fs.readFileSync(workflowPath, 'utf8') : '';

// 2. Triggered on push to master only (with optional manual dispatch).
//    The user-confirmed trigger choice was "On push to master only";
//    pin it so a future edit can't silently widen the trigger to dev
//    branches.
{
  // Match the YAML shape: `on:\n  push:\n    branches: [master]`.
  // Tolerant of either inline or block list form.
  const hasPushMaster =
    /on:\s*[\s\S]*?push:\s*[\s\S]*?branches:\s*\[\s*master\s*\]/m.test(src) ||
    /on:\s*[\s\S]*?push:\s*[\s\S]*?branches:\s*-\s*master/m.test(src);
  assert(hasPushMaster, 'workflow triggers on push to master');

  // Make sure it does NOT trigger on push to other branches (e.g.
  // claude/*, main, '**') — that would re-introduce stale-deploy
  // races and contradict the user's choice.
  assert(
    !/branches:\s*\[\s*['"]?\*\*['"]?\s*\]/.test(src) &&
      !/branches:\s*\[\s*claude/.test(src) &&
      !/branches:\s*\[\s*main\s*[,\]]/.test(src),
    'workflow does not trigger on dev / wildcard branches',
  );
}

// 3. Permissions: pages: write + id-token: write
{
  assert(/pages:\s*write/.test(src), 'permissions: pages: write declared');
  assert(/id-token:\s*write/.test(src), 'permissions: id-token: write declared');
}

// 4. Build steps: npm ci + npm run build + upload dist
{
  assert(/run:\s*npm ci\b/.test(src), 'workflow runs `npm ci`');
  assert(/run:\s*npm run build\b/.test(src), 'workflow runs `npm run build`');
  assert(
    /actions\/upload-pages-artifact@v3[\s\S]*?path:\s*dist/.test(src),
    'workflow uploads `dist` via actions/upload-pages-artifact@v3',
  );
}

// 5. Deploy step uses actions/deploy-pages@v4
{
  assert(
    /deploy:\s*[\s\S]*?if:\s*\$\{\{\s*vars\.ENABLE_GITHUB_PAGES_DEPLOY\s*==\s*'true'\s*\}\}/.test(src),
    'deploy job is gated by ENABLE_GITHUB_PAGES_DEPLOY',
  );
  assert(
    /actions\/deploy-pages@v4/.test(src),
    'deploy step uses actions/deploy-pages@v4',
  );
}

// 6. Concurrency group on pages so two rapid master pushes don't
//    race. cancel-in-progress is reasonable so the latest push wins.
{
  assert(
    /concurrency:\s*[\s\S]*?group:\s*pages/.test(src),
    'workflow declares a `pages` concurrency group',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
