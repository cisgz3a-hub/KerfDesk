/**
 * T1-78 Phase 3: the deprecated `requireFeature` alias has been
 * removed from `src/entitlements/index.ts`. This test pins that
 * removal so a future caller cannot silently re-introduce the
 * naming-hazard alias.
 *
 * Companion to Phase 2b's global "no internal caller of
 * requireFeature" sweep — Phase 2b guarantees every src/ file is
 * migrated; Phase 3 guarantees the alias itself is gone, closing
 * the foot-gun loop.
 *
 * Run: npx tsx tests/entitlement-api-no-deprecated-export.test.ts
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

async function run(): Promise<void> {
  console.log('\n=== T1-78 Phase 3 deprecated-alias-removed ===\n');

  // Source-of-truth file: the entitlements barrel.
  {
    const src = read('src/entitlements/index.ts');
    assert(!/export function requireFeature\(/.test(src),
      'src/entitlements/index.ts no longer declares `export function requireFeature`');
    assert(!/@deprecated/.test(src),
      'src/entitlements/index.ts no longer carries an @deprecated annotation (the alias was the only deprecated symbol)');
    // Positive: the new API is still there.
    assert(/export function canUseFeature\(/.test(src),
      'canUseFeature still exported (regression guard against accidental removal)');
    assert(/export function assertFeature\(/.test(src),
      'assertFeature still exported (regression guard against accidental removal)');
    assert(/export class EntitlementError/.test(src),
      'EntitlementError still exported (regression guard against accidental removal)');
  }

  // Runtime check: importing requireFeature from the barrel must fail.
  {
    const mod = (await import('../src/entitlements')) as unknown as Record<string, unknown>;
    assert(typeof mod.canUseFeature === 'function', 'barrel exports canUseFeature at runtime');
    assert(typeof mod.assertFeature === 'function', 'barrel exports assertFeature at runtime');
    assert(typeof mod.EntitlementError === 'function', 'barrel exports EntitlementError at runtime');
    assert(mod.requireFeature === undefined,
      'barrel does NOT export requireFeature at runtime (Phase 3 alias removal)');
  }

  // Spot-check the seven migrated files; a full src/ walk is Phase 2b's job.
  {
    const filesToCheck = [
      'src/entitlements/index.ts',
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
        `${file} contains no reference to requireFeature (post-Phase-3 final state)`);
    }
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
