import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildAutosavePayloadPlan,
  shouldPersistAutosaveForHash,
  shouldSkipAutosaveForRunningJob,
} from '../src/ui/components/app/appAutosaveHelpers';
import { createScene } from '../src/core/scene/Scene';
import { hashSceneForPersistence } from '../src/core/scene/sceneDirtyHash';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();

console.log('\n=== T2-6 Phase 3ak/3as app autosave helpers ===\n');

assert(
  shouldSkipAutosaveForRunningJob({ appJobRunning: true, controllerJobRunning: false }),
  'app job-running state skips autosave',
);
assert(
  shouldSkipAutosaveForRunningJob({ appJobRunning: false, controllerJobRunning: true }),
  'controller job-running state skips autosave',
);
assert(
  !shouldSkipAutosaveForRunningJob({ appJobRunning: false, controllerJobRunning: false }),
  'idle app/controller allow autosave work',
);

assert(
  shouldPersistAutosaveForHash({ currentHash: 'next', lastAutosaveHash: 'prev' }),
  'changed scene hash should persist autosave',
);
assert(
  !shouldPersistAutosaveForHash({ currentHash: 'same', lastAutosaveHash: 'same' }),
  'unchanged scene hash skips autosave',
);

{
  const scene = createScene(400, 300, 'autosave unchanged');
  const currentHash = hashSceneForPersistence(scene);
  const plan = buildAutosavePayloadPlan({ scene, lastAutosaveHash: currentHash });
  assert(plan.kind === 'skip-unchanged', 'autosave payload plan skips unchanged scene');
}

{
  const scene = createScene(400, 300, 'autosave changed');
  const plan = buildAutosavePayloadPlan({ scene, lastAutosaveHash: 'previous-hash' });
  assert(plan.kind === 'persist', 'autosave payload plan persists changed scene');
  if (plan.kind === 'persist') {
    assert(plan.currentHash === hashSceneForPersistence(scene), 'persist plan carries current scene hash');
    assert(plan.json.includes('"scene"'), 'persist plan carries serialized autosave json');
  }
}

const appSource = readFileSync(resolve(root, 'src/ui/components/App.tsx'), 'utf8');
const helperSource = readFileSync(resolve(root, 'src/ui/components/app/appAutosaveHelpers.ts'), 'utf8');

assert(
  appSource.includes('shouldSkipAutosaveForRunningJob'),
  'App imports and uses shouldSkipAutosaveForRunningJob',
);
assert(
  appSource.includes('buildAutosavePayloadPlan'),
  'App delegates autosave hash + serialization payload decisions to buildAutosavePayloadPlan',
);
assert(
  !appSource.includes('serializeForAutosave(scene)'),
  'App no longer serializes autosave payloads inline',
);
assert(
  !appSource.includes('currentHash === lastAutosaveHashRef.current'),
  'App no longer carries autosave hash equality policy inline',
);
assert(
  helperSource.includes('T2-6 Phase 3as'),
  'appAutosaveHelpers carries the T2-6 Phase 3as marker',
);

console.log('Autosave payload planning is extracted from App.');
