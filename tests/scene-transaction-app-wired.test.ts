/**
 * T2-76 step 2 regression: verifies App.tsx imports and instantiates
 * the unified scene-mutation function.
 *
 * The unit tests in scene-transaction-unified.test.ts cover the
 * function's behavior. This test guards a different invariant: that
 * App.tsx is actually wired up to use the function, so an unrelated
 * later refactor cannot accidentally remove the import or the
 * factory call without a test failure.
 *
 * Step 2 of 8 of the T2-76 migration. The function is instantiated but
 * not yet referenced by any caller. Steps 3-7 migrate callers; this
 * test continues to apply through all of them and beyond.
 *
 * Run: npx tsx tests/scene-transaction-app-wired.test.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appTsxPath = resolve(here, '../src/ui/components/App.tsx');
const appTsx = readFileSync(appTsxPath, 'utf-8');

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

console.log('\n=== T2-76 step 2 wiring regression ===\n');

assert(
  /from\s+['"]\.\.\/scene\/SceneTransaction['"]/.test(appTsx),
  'App.tsx imports from ../scene/SceneTransaction',
);

assert(
  /\bmakeCommitSceneTransaction\b/.test(appTsx),
  'App.tsx references makeCommitSceneTransaction by name',
);

assert(
  /makeCommitSceneTransaction\s*\(/.test(appTsx),
  'App.tsx calls makeCommitSceneTransaction (factory invocation present)',
);

assert(
  /\bCommitSceneTransaction\b/.test(appTsx),
  'App.tsx imports the CommitSceneTransaction type for explicit binding type',
);

assert(
  /\bcommitSceneTransaction\s*\(/.test(appTsx),
  'App.tsx contains at least one commitSceneTransaction(...) call (caller migration in progress, T2-76 step 3+)',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
