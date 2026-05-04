/**
 * T1-78 Phase 2a: service-layer caller migration off the deprecated
 * `requireFeature` alias. This test pins the post-migration shape:
 *
 *   - Nester.ts      uses `assertFeature('nesting')`        (enforcement)
 *   - BooleanOps.ts  uses `assertFeature('boolean_ops')`    (enforcement)
 *   - JobCompiler.ts uses `canUseFeature('<flag>')` × 6     (boolean flag-builder)
 *
 * Plus: each file no longer imports `requireFeature`, and the
 * deprecated alias is still exported from the entitlements barrel
 * (so the four UI-hook callers slated for Phase 2b keep working).
 *
 * Run: npx tsx tests/entitlement-api-migration-phase2a.test.ts
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

console.log('\n=== T1-78 Phase 2a migration ===\n');

// Nester.ts
{
  const src = read('src/core/nesting/Nester.ts');
  assert(/import\s*\{[^}]*\bassertFeature\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/entitlements['"]/.test(src),
    'Nester.ts imports assertFeature from entitlements');
  assert(!/\brequireFeature\b/.test(src), 'Nester.ts no longer references requireFeature');
  // Two enforcement sites; each calls assertFeature('nesting').
  const matches = src.match(/assertFeature\('nesting'\)/g) ?? [];
  assert(matches.length === 2, `Nester.ts has 2 assertFeature('nesting') call sites (got ${matches.length})`);
  // Old ad-hoc throw is gone — assertFeature throws EntitlementError.
  assert(!/throw\s+new\s+Error\([^)]*Nesting requires a Pro license/.test(src),
    "Nester.ts: legacy `throw new Error('Nesting requires a Pro license')` is gone");
}

// BooleanOps.ts
{
  const src = read('src/geometry/BooleanOps.ts');
  assert(/import\s*\{[^}]*\bassertFeature\b[^}]*\}\s*from\s*['"]\.\.\/entitlements['"]/.test(src),
    'BooleanOps.ts imports assertFeature from entitlements');
  assert(!/\brequireFeature\b/.test(src), 'BooleanOps.ts no longer references requireFeature');
  assert(/assertFeature\('boolean_ops'\)/.test(src),
    "BooleanOps.ts has assertFeature('boolean_ops') at the booleanOperation entry");
  assert(!/throw\s+new\s+Error\([^)]*Boolean operations require a Pro license/.test(src),
    "BooleanOps.ts: legacy `throw new Error('Boolean operations require a Pro license')` is gone");
}

// JobCompiler.ts
{
  const src = read('src/core/job/JobCompiler.ts');
  assert(/import\s*\{[^}]*\bcanUseFeature\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/entitlements['"]/.test(src),
    'JobCompiler.ts imports canUseFeature from entitlements');
  assert(!/\brequireFeature\b/.test(src), 'JobCompiler.ts no longer references requireFeature');
  for (const flag of ['tabs', 'overcut', 'lead_in', 'cross_hatch', 'power_scale', 'cut_start_point']) {
    assert(
      new RegExp(`canUseFeature\\('${flag}'\\)`).test(src),
      `JobCompiler.ts has canUseFeature('${flag}') for flag-builder`,
    );
  }
}

// Deprecated alias still in the barrel so Phase 2b's UI-hook callers
// keep working.
{
  const src = read('src/entitlements/index.ts');
  assert(/@deprecated/.test(src), 'entitlements/index.ts marks the deprecated alias');
  assert(/export function requireFeature\(/.test(src),
    'entitlements/index.ts still exports requireFeature for unmigrated UI-hook callers');
}

// UI-hook callers are migrated in Phase 2b — see
// `tests/entitlement-api-migration-phase2b.test.ts` for the
// post-2b shape assertions. This test continues to pin only the
// service-layer files Phase 2a touched.

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
