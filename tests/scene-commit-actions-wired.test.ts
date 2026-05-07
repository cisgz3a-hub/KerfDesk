/**
 * T2-76 step 7 regression: verifies the SceneCommitAction union
 * is in place and the five migrated hook files import + use it.
 *
 * The unit tests in scene-transaction-unified.test.ts cover the
 * dispatch function's behavior. This test guards a different
 * invariant: that the action-label discipline introduced by step 7
 * is actually wired up across the five named hook files. A future
 * refactor can't accidentally drop an import or revert a labeled
 * call to a defaulted call without one of these assertions failing.
 *
 * Doesn't check label correctness per call site (that's covered by
 * TypeScript narrowing - typos fail to compile against the union);
 * just verifies the wiring is present.
 *
 * Run: npx tsx tests/scene-commit-actions-wired.test.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf-8');

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

console.log('\n=== T2-76 step 7 SceneCommitAction wiring ===\n');

const unionFile = read('src/ui/scene/SceneCommitActions.ts');

assert(
  /export type SceneCommitAction\b/.test(unionFile),
  'SceneCommitActions.ts exports SceneCommitAction type',
);

assert(
  /'unspecified'/.test(unionFile),
  'SceneCommitAction union retains unspecified fallback',
);

const migratedHooks = [
  'src/ui/hooks/useClipboard.ts',
  'src/ui/hooks/useConnectionHandlers.ts',
  'src/ui/hooks/useGeneratorHandlers.ts',
  'src/ui/hooks/useImport.ts',
  'src/ui/hooks/useKerfHandlers.ts',
];

for (const f of migratedHooks) {
  const src = read(f);
  assert(
    /\bSceneCommitAction\b/.test(src),
    `${f} references SceneCommitAction`,
  );
  if (!/handleSceneCommit\(/.test(src)) {
    assert(
      f === 'src/ui/hooks/useConnectionHandlers.ts',
      `${f} no longer performs scene commits after T2-61`,
    );
    continue;
  }
  // At least one handleSceneCommit(...) call passes a kebab-case
  // string literal as its second argument. Excludes pure type-
  // signature lines. Accepts both 2-arg and 3-arg forms.
  assert(
    /handleSceneCommit\([\s\S]*?,\s*'[a-z][a-z0-9-]*'\s*[,)]/.test(src),
    `${f} contains at least one handleSceneCommit call with a label`,
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
