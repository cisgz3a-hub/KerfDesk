/**
 * T2-106: dependency security scanning in CI. Pre-T2-106 the license
 * check workflow caught GPL/AGPL contamination but no `npm audit`
 * step ran in CI; production-dependency CVEs landed silently. No
 * Dependabot config either, so security advisories required manual
 * polling. Audit 5B Priority 10.
 *
 * This is a meta-test — it pins the CI configuration files. The
 * actual `npm audit` runs against the live dependency tree at CI
 * time; this test ensures the wiring is in place so it can never be
 * silently removed.
 *
 * Run: npx tsx tests/dependency-security-scan.test.ts
 */

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T2-106 Dependency security scanning ===\n');

void (async () => {

const fs = await import('node:fs');
const url = await import('node:url');
const path = await import('node:path');
const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// 1. CI workflow exists
{
  const ciPath = path.resolve(repoRoot, '.github/workflows/ci.yml');
  assert(fs.existsSync(ciPath), `.github/workflows/ci.yml exists`);
}

// 2. CI workflow includes the `npm audit` step with --omit=dev + audit-level
{
  const ci = fs.readFileSync(path.resolve(repoRoot, '.github/workflows/ci.yml'), 'utf-8');
  assert(/npm audit/.test(ci), `ci.yml runs 'npm audit'`);
  assert(/--omit=dev/.test(ci),
    `ci.yml: 'npm audit' uses --omit=dev (dev CVEs don't ship)`);
  assert(/--audit-level=moderate/.test(ci),
    `ci.yml: 'npm audit' uses --audit-level=moderate`);
  assert(/T2-106/.test(ci),
    `ci.yml carries the T2-106 marker comment`);
}

// 3. CI workflow ordering: audit BEFORE build (so a bad dep bumps fails fast,
//    saves CI minutes on the build/test steps)
{
  const ci = fs.readFileSync(path.resolve(repoRoot, '.github/workflows/ci.yml'), 'utf-8');
  const auditIdx = ci.indexOf('npm audit');
  const buildIdx = ci.indexOf('npm run build');
  assert(auditIdx > 0 && buildIdx > 0,
    `both 'npm audit' and 'npm run build' steps present`);
  assert(auditIdx < buildIdx,
    `'npm audit' runs BEFORE 'npm run build' (fast-fail on bad dep)`);
}

// 4. Dependabot config file exists
{
  const dbPath = path.resolve(repoRoot, '.github/dependabot.yml');
  assert(fs.existsSync(dbPath), `.github/dependabot.yml exists`);
}

// 5. Dependabot config: npm ecosystem + weekly schedule
{
  const db = fs.readFileSync(path.resolve(repoRoot, '.github/dependabot.yml'), 'utf-8');
  assert(/version:\s*2/.test(db), `dependabot.yml is version 2`);
  assert(/package-ecosystem:\s*['"]npm['"]/.test(db),
    `dependabot.yml has npm ecosystem`);
  assert(/interval:\s*['"]weekly['"]/.test(db),
    `dependabot.yml: weekly interval for npm ecosystem`);
  assert(/T2-106/.test(db),
    `dependabot.yml carries the T2-106 marker comment`);
}

// 6. Dependabot config: production-security group with applies-to=security-updates
{
  const db = fs.readFileSync(path.resolve(repoRoot, '.github/dependabot.yml'), 'utf-8');
  assert(/production-security/.test(db),
    `dependabot.yml has 'production-security' group`);
  assert(/applies-to:\s*security-updates/.test(db),
    `dependabot.yml: production-security applies to security-updates`);
}

// 7. Dependabot config: github-actions ecosystem (the workflow files
//    themselves should be kept up to date)
{
  const db = fs.readFileSync(path.resolve(repoRoot, '.github/dependabot.yml'), 'utf-8');
  assert(/github-actions/.test(db),
    `dependabot.yml has github-actions ecosystem`);
}

// 8. Dependabot config: dev-dep groups exclude security CVE bundling
//    (so security PRs aren't buried in @types/* batches)
{
  const db = fs.readFileSync(path.resolve(repoRoot, '.github/dependabot.yml'), 'utf-8');
  assert(/exclude-patterns/.test(db),
    `dependabot.yml has exclude-patterns to keep security PRs unbatched`);
  for (const dev of ['@types/*', 'eslint*', 'tsx']) {
    assert(db.includes(`"${dev}"`) || db.includes(`'${dev}'`),
      `dev-dep '${dev}' present (excluded from production-security group)`);
  }
}

// 9. License-check workflow still exists (was not replaced — they
//    catch different things)
{
  const lcPath = path.resolve(repoRoot, '.github/workflows/license-check.yml');
  assert(fs.existsSync(lcPath),
    `license-check.yml still exists (license + audit are complementary)`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
