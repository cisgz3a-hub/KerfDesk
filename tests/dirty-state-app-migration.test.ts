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
  appSource.includes('lastSavedSceneHashRef'),
  'App.tsx tracks last saved scene hash',
);
assert(
  appSource.includes('useRef<string>(hashSceneForPersistence(scene))'),
  'App.tsx initializes the clean baseline from the initial scene hash',
);
assert(
  appSource.includes('isDirty(scene, lastSavedSceneHashRef.current)'),
  'App.tsx derives dirty state from the current scene hash',
);
assert(
  appSource.includes('lastSavedSceneHashRef.current = hashSceneForPersistence(newScene)'),
  'loaded/new projects become the clean hash baseline',
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
