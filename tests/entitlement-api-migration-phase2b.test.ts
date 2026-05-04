/**
 * T1-78 Phase 2b: UI-hook caller migration off the deprecated
 * `requireFeature` alias. All four hooks use enforcement-style
 * gating (`if (!requireFeature(x)) throw …`), so Phase 2b migrates
 * each to `assertFeature(x)`. This test pins the post-migration
 * shape per file:
 *
 *   - useSceneOperations.ts     → assertFeature('text_to_path')
 *   - useGeneratorHandlers.ts   → assertFeature('variable_text')
 *   - useMaterialTestHandlers.ts → assertFeature('material_test')
 *   - useKerfHandlers.ts        → assertFeature('kerf_wizard')   × 3
 *
 * After Phase 2b, no internal caller of `requireFeature` remains —
 * the deprecated alias is kept exported for external/source-pin
 * consumers but is unused inside the repo.
 *
 * Run: npx tsx tests/entitlement-api-migration-phase2b.test.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf-8');

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

console.log('\n=== T1-78 Phase 2b migration ===\n');

const HOOKS: Array<{ file: string; feature: string; siteCount: number }> = [
  { file: 'src/ui/hooks/useSceneOperations.ts', feature: 'text_to_path', siteCount: 1 },
  { file: 'src/ui/hooks/useGeneratorHandlers.ts', feature: 'variable_text', siteCount: 1 },
  { file: 'src/ui/hooks/useMaterialTestHandlers.ts', feature: 'material_test', siteCount: 1 },
  { file: 'src/ui/hooks/useKerfHandlers.ts', feature: 'kerf_wizard', siteCount: 3 },
];

for (const { file, feature, siteCount } of HOOKS) {
  const src = read(file);
  assert(/import\s*\{[^}]*\bassertFeature\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/entitlements['"]/.test(src),
    `${file} imports assertFeature from entitlements`);
  assert(!/\brequireFeature\b/.test(src),
    `${file} no longer references requireFeature`);
  const re = new RegExp(`assertFeature\\('${feature}'\\)`, 'g');
  const matches = src.match(re) ?? [];
  assert(matches.length === siteCount,
    `${file} has ${siteCount} assertFeature('${feature}') call site${siteCount > 1 ? 's' : ''} (got ${matches.length})`);
  // Old ad-hoc throws should be gone.
  const legacyThrow = new RegExp(`throw\\s+new\\s+Error\\([^)]*requires\\s+a\\s+Pro\\s+license`);
  assert(!legacyThrow.test(src),
    `${file}: legacy ad-hoc \`throw new Error('… requires a Pro license')\` is gone`);
}

// The deprecated alias remains exported so external consumers and
// source-pin tests don't break — its absence is not the contract,
// only the absence of internal callers is.
{
  const src = read('src/entitlements/index.ts');
  assert(/@deprecated/.test(src), 'entitlements/index.ts marks the deprecated alias');
  assert(/export function requireFeature\(/.test(src),
    'entitlements/index.ts still exports requireFeature (alias retained)');
}

// After Phase 2b, no production caller in src/ outside the
// entitlements barrel itself uses requireFeature.
{
  const filesToCheck = [
    'src/core/nesting/Nester.ts',
    'src/geometry/BooleanOps.ts',
    'src/core/job/JobCompiler.ts',
    'src/ui/hooks/useSceneOperations.ts',
    'src/ui/hooks/useGeneratorHandlers.ts',
    'src/ui/hooks/useMaterialTestHandlers.ts',
    'src/ui/hooks/useKerfHandlers.ts',
  ];
  for (const file of filesToCheck) {
    const src = read(file);
    assert(!/\brequireFeature\b/.test(src),
      `post-2b: ${file} no longer uses the deprecated requireFeature alias`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
