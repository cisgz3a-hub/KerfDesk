import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createScene } from '../src/core/scene/Scene';
import { hashSceneForPersistence } from '../src/core/scene/sceneDirtyHash';
import {
  buildProjectLoadCommitPlan,
  buildSceneSavedBaselinePlan,
  type ProjectLoadSource,
} from '../src/ui/components/app/appProjectLoadHelpers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

console.log('\n=== T2-6 Phase 3at/3au app project-load helpers ===\n');

for (const source of ['file', 'autosave', 'new'] satisfies ProjectLoadSource[]) {
  const scene = createScene(400, 300, `project load ${source}`);
  const plan = buildProjectLoadCommitPlan(scene, source);
  assert(plan.cleanHash === hashSceneForPersistence(scene), `${source} plan carries loaded scene clean hash`);
  assert(plan.reason.kind === 'load', `${source} plan uses a load transaction`);
  assert(plan.reason.source === source, `${source} plan preserves load source`);
  assert(plan.meta.selectionAfter instanceof Set, `${source} plan carries selection reset set`);
  assert(plan.meta.selectionAfter.size === 0, `${source} plan clears selection after load`);
}

{
  const savedScene = createScene(400, 300, 'manual save baseline');
  const plan = buildSceneSavedBaselinePlan(savedScene);
  assert(plan.cleanHash === hashSceneForPersistence(savedScene), 'manual-save baseline plan carries saved scene hash');
}

const root = process.cwd();
const appSource = readFileSync(resolve(root, 'src/ui/components/App.tsx'), 'utf8');
const helperSource = readFileSync(resolve(root, 'src/ui/components/app/appProjectLoadHelpers.ts'), 'utf8');

assert(
  appSource.includes('buildProjectLoadCommitPlan'),
  'App delegates load baseline planning to buildProjectLoadCommitPlan',
);
assert(
  !appSource.includes('hashSceneForPersistence(newScene)'),
  'App no longer hashes loaded scenes inline',
);
assert(
  appSource.includes('buildSceneSavedBaselinePlan(savedScene)'),
  'App delegates manual-save baseline planning to buildSceneSavedBaselinePlan',
);
assert(
  !appSource.includes('hashSceneForPersistence(savedScene)'),
  'App no longer hashes saved scenes inline',
);
assert(
  helperSource.includes('T2-6 Phase 3at'),
  'appProjectLoadHelpers carries the T2-6 Phase 3at marker',
);
assert(
  helperSource.includes('T2-6 Phase 3au'),
  'appProjectLoadHelpers carries the T2-6 Phase 3au marker',
);

console.log('Project load/save baseline planning is extracted from App.');
