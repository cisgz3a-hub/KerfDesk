import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();
const propertiesPanelSource = readFileSync(
  resolve(root, 'src/ui/components/PropertiesPanel.tsx'),
  'utf8',
);
const actionSource = readFileSync(
  resolve(root, 'src/ui/scene/SceneCommitActions.ts'),
  'utf8',
);

console.log('\n=== T1-17 trace selection atomic commit ===\n');

assert(
  /import type \{ SceneCommitAction \} from ['"]\.\.\/scene\/SceneCommitActions['"]/.test(propertiesPanelSource),
  'PropertiesPanel should type scene commits with SceneCommitAction',
);

assert(
  /onSceneCommit:\s*\(\s*scene:\s*Scene,\s*action\?:\s*SceneCommitAction,\s*selectionAfter\?:\s*ReadonlySet<string>\s*\)\s*=>\s*void/.test(propertiesPanelSource),
  'ObjectPropertiesTab should allow atomic scene commit plus selectionAfter metadata',
);

assert(
  /\|\s*'trace-to-vector'/.test(actionSource),
  'SceneCommitAction should include the trace-to-vector action label',
);

assert(
  /onSceneCommit\(newScene,\s*'trace-to-vector',\s*new Set\(\[addedObjectId\]\)\)/.test(propertiesPanelSource),
  'Trace completion should select the traced object through the same scene commit transaction',
);

assert(
  !/onSelectionChange\?\.\(new Set\(\[addedObjectId\]\)\)/.test(propertiesPanelSource),
  'Trace completion should not issue a second standalone selection update after scene commit',
);

console.log('Trace completion now commits scene + selection atomically.');
