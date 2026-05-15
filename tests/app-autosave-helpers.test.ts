import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  shouldPersistAutosaveForHash,
  shouldSkipAutosaveForRunningJob,
} from '../src/ui/components/app/appAutosaveHelpers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();

console.log('\n=== T2-6 Phase 3ak app autosave helpers ===\n');

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

const appSource = readFileSync(resolve(root, 'src/ui/components/App.tsx'), 'utf8');
const helperSource = readFileSync(resolve(root, 'src/ui/components/app/appAutosaveHelpers.ts'), 'utf8');

assert(
  appSource.includes('shouldSkipAutosaveForRunningJob'),
  'App imports and uses shouldSkipAutosaveForRunningJob',
);
assert(
  appSource.includes('shouldPersistAutosaveForHash'),
  'App imports and uses shouldPersistAutosaveForHash',
);
assert(
  !appSource.includes('currentHash === lastAutosaveHashRef.current'),
  'App no longer carries autosave hash equality policy inline',
);
assert(
  helperSource.includes('T2-6 Phase 3ak'),
  'appAutosaveHelpers carries the T2-6 Phase 3ak marker',
);

console.log('Autosave skip/persist decisions are extracted from App.');
