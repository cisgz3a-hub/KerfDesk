/**
 * T2-91: FEATURE_MATRIX enforcement test. Pre-T2-91 there was no
 * declarative registry stating "for feature X, enforcement MUST exist
 * at layers Y and Z." This test scans the source tree and asserts:
 *
 *   - every feature claiming `service` enforcement has at least one
 *     `assertFeature('${id}')` callsite outside the entitlements
 *     module itself;
 *   - every feature claiming `compiler` enforcement has the
 *     corresponding `allow${Camel}` flag in JobCompiler.ts;
 *   - every Pro feature in `PRO_FEATURES` is declared in the matrix
 *     (no orphan Pro features that nobody is enforcing).
 *
 * Adding a Pro feature to `FEATURE_MATRIX` with a layer claim that
 * isn't satisfied fails this test.
 *
 * Run: npx tsx tests/feature-matrix-enforcement.test.ts
 */
import {
  FEATURE_MATRIX,
  featuresEnforcedAt,
  getFeatureDefinition,
  compilerAllowFlagName,
  type EnforcementLayer,
} from '../src/entitlements/FeatureMatrix';
import { PRO_FEATURES } from '../src/entitlements/types';

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

console.log('\n=== T2-91 FEATURE_MATRIX enforcement ===\n');

void (async () => {

const fs = await import('node:fs');
const url = await import('node:url');
const path = await import('node:path');
const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Cache: read every src/**/*.{ts,tsx} once.
const srcRoot = path.join(repoRoot, 'src');
const sourceFiles = walk(srcRoot);
const fileContent = new Map<string, string>();
for (const f of sourceFiles) {
  fileContent.set(f, fs.readFileSync(f, 'utf-8'));
}

function existsOutsideEntitlements(needle: RegExp): { matched: boolean; samples: string[] } {
  const samples: string[] = [];
  for (const [f, content] of fileContent) {
    if (f.includes(`${path.sep}entitlements${path.sep}`)) continue;
    if (needle.test(content)) {
      samples.push(path.relative(repoRoot, f));
      if (samples.length >= 3) break;
    }
  }
  return { matched: samples.length > 0, samples };
}

// 1. Every Pro feature in PRO_FEATURES has a matrix entry
{
  const matrixIds = new Set(FEATURE_MATRIX.map((f) => f.id));
  for (const id of PRO_FEATURES) {
    assert(matrixIds.has(id),
      `PRO_FEATURES '${id}' has matrix entry`);
  }
}

// 2. Matrix has no entries that are NOT in PRO_FEATURES
{
  const proSet = new Set<string>(PRO_FEATURES);
  for (const f of FEATURE_MATRIX) {
    assert(proSet.has(f.id),
      `matrix entry '${f.id}' is in PRO_FEATURES`);
  }
}

// 3. Every feature claiming service enforcement has assertFeature() callsite
{
  for (const f of featuresEnforcedAt('service')) {
    const re = new RegExp(`assertFeature\\(['"]${f.id}['"]\\)`);
    const r = existsOutsideEntitlements(re);
    assert(r.matched,
      `service-enforced '${f.id}': has assertFeature callsite (${r.samples.join(', ') || 'NONE FOUND'})`);
  }
}

// 4. Every feature claiming compiler enforcement has allow* flag in JobCompiler
{
  const jobCompilerPath = path.join(repoRoot, 'src/core/job/JobCompiler.ts');
  const jc = fs.readFileSync(jobCompilerPath, 'utf-8');
  for (const f of featuresEnforcedAt('compiler')) {
    const flag = compilerAllowFlagName(f.id);
    const reAllow = new RegExp(`${flag}\\s*:\\s*canUseFeature\\(['"]${f.id}['"]\\)`);
    assert(reAllow.test(jc),
      `compiler-enforced '${f.id}': JobCompiler has '${flag}: canUseFeature("${f.id}")' (got ${reAllow.test(jc)})`);
  }
}

// 5. compilerAllowFlagName: round-trip correctness
{
  assert(compilerAllowFlagName('tabs') === 'allowTabs',
    `compilerAllowFlagName('tabs') === 'allowTabs'`);
  assert(compilerAllowFlagName('cross_hatch') === 'allowCrossHatch',
    `compilerAllowFlagName('cross_hatch') === 'allowCrossHatch'`);
  assert(compilerAllowFlagName('cut_start_point') === 'allowCutStartPoint',
    `compilerAllowFlagName('cut_start_point') === 'allowCutStartPoint'`);
  assert(compilerAllowFlagName('lead_in') === 'allowLeadIn',
    `compilerAllowFlagName('lead_in') === 'allowLeadIn'`);
}

// 6. getFeatureDefinition: positive + negative
{
  const tabs = getFeatureDefinition('tabs');
  assert(tabs != null && tabs.label === 'Cut tabs',
    `getFeatureDefinition('tabs').label = 'Cut tabs'`);
  // negative case: non-existent ID — cast through unknown for the test
  const nope = getFeatureDefinition('not_a_real_feature' as unknown as Parameters<typeof getFeatureDefinition>[0]);
  assert(nope === null, `getFeatureDefinition unknown → null`);
}

// 7. featuresEnforcedAt returns the right shape
{
  for (const layer of ['ui', 'service', 'compiler', 'export'] as EnforcementLayer[]) {
    const list = featuresEnforcedAt(layer);
    for (const f of list) {
      assert(f.enforcement.includes(layer),
        `featuresEnforcedAt('${layer}'): every entry includes '${layer}' (entry: ${f.id})`);
    }
  }
}

// 8. Every matrix entry has at least one enforcement layer
{
  for (const f of FEATURE_MATRIX) {
    assert(f.enforcement.length > 0,
      `'${f.id}': enforcement is non-empty`);
  }
}

// 9. Every matrix entry has at least one non-UI enforcement layer
//    (UI alone is bypassable; the matrix is the security contract)
{
  for (const f of FEATURE_MATRIX) {
    const nonUi = f.enforcement.filter((l) => l !== 'ui');
    assert(nonUi.length > 0,
      `'${f.id}': has at least one non-UI enforcement layer (got ${f.enforcement.join(',')})`);
  }
}

// 10. Source-level pin
{
  const src = fileContent.get(path.join(srcRoot, 'entitlements/FeatureMatrix.ts')) ?? '';
  assert(/T2-91/.test(src), 'T2-91 marker in FeatureMatrix.ts');
  for (const fn of ['FEATURE_MATRIX', 'getFeatureDefinition', 'featuresEnforcedAt', 'compilerAllowFlagName']) {
    assert(src.includes(fn), `helper ${fn} declared`);
  }
  for (const layer of ['ui', 'service', 'compiler', 'export']) {
    assert(src.includes(`'${layer}'`), `EnforcementLayer '${layer}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
