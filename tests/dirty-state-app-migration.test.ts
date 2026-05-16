import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx'), 'utf8');
const fileHandlersSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'hooks', 'useFileHandlers.ts'), 'utf8');

assert(
  appSource.includes("import { hashSceneForPersistence, isDirty } from '../../core/scene/sceneDirtyHash'"),
  'App.tsx imports hash-derived dirty helpers',
);
assert(
  !appSource.includes('sceneIsDirtyRef'),
  'App.tsx no longer owns or reads sceneIsDirtyRef',
);
assert(
  !appSource.includes('lastSavedSceneRef'),
  'App.tsx no longer compares serialized scene JSON for dirty state',
);
assert(
  appSource.includes('lastManualSaveHashRef'),
  'App.tsx tracks the manual-save clean hash',
);
assert(
  appSource.includes('useRef<string>(hashSceneForPersistence(scene))'),
  'App.tsx initializes the manual clean baseline from the initial scene hash',
);
assert(
  appSource.includes('isDirty(scene, lastManualSaveHashRef.current)'),
  'App.tsx derives manual dirty state from the current scene hash',
);
assert(
  appSource.includes('buildProjectLoadCommitPlan(newScene, source)'),
  'loaded/new projects delegate clean-hash baseline planning',
);
assert(
  appSource.includes('lastManualSaveHashRef.current = lastAutosaveHashRef.current = plan.cleanHash'),
  'loaded/new projects become the manual and autosave clean hash baselines',
);
assert(
  !appSource.includes('hashSceneForPersistence(newScene)'),
  'loaded/new project hash calculation is no longer inline in App.tsx',
);

assert(
  !fileHandlersSource.includes('sceneIsDirtyRef'),
  'useFileHandlers no longer accepts sceneIsDirtyRef',
);
assert(
  !fileHandlersSource.includes('lastSavedSceneRef'),
  'useFileHandlers no longer accepts lastSavedSceneRef',
);
assert(
  fileHandlersSource.includes('markSceneSaved'),
  'useFileHandlers delegates confirmed save baseline updates to markSceneSaved',
);
