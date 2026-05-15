import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createScene } from '../src/core/scene/Scene';
import { buildStartModeSelectionCommit } from '../src/ui/components/app/appStartModeSelectionHelpers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();

console.log('\n=== T2-6 Phase 3ad app start-mode selection helpers ===\n');

{
  const scene = createScene(400, 300, 'Start mode helper test');
  const result = buildStartModeSelectionCommit(scene, 'absolute', { x: 12.4, y: 98.6 });
  assert(result.action === 'start-position', 'start-mode helper uses start-position action');
  assert(result.scene !== scene, 'start-mode helper returns a new scene');
  assert(result.scene.startPosition.x === 12, 'start X is rounded');
  assert(result.scene.startPosition.y === 99, 'start Y is rounded');
  assert(result.shouldResetWcs === true, 'absolute mode resets WCS');
}

{
  const scene = createScene(400, 300, 'Start mode helper test');
  const result = buildStartModeSelectionCommit(scene, 'current', { x: 10.5, y: 20.5 });
  assert(result.scene.startPosition.x === 11, 'current mode rounds .5 X up');
  assert(result.scene.startPosition.y === 21, 'current mode rounds .5 Y up');
  assert(result.shouldResetWcs === true, 'current mode resets WCS');
}

{
  const scene = createScene(400, 300, 'Start mode helper test');
  const result = buildStartModeSelectionCommit(scene, 'savedOrigin', { x: -3.6, y: 4.4 });
  assert(result.scene.startPosition.x === -4, 'saved-origin mode rounds negative X');
  assert(result.scene.startPosition.y === 4, 'saved-origin mode rounds Y');
  assert(result.shouldResetWcs === false, 'saved-origin mode preserves WCS');
}

const appSource = readFileSync(resolve(root, 'src/ui/components/App.tsx'), 'utf8');
const helperSource = readFileSync(resolve(root, 'src/ui/components/app/appStartModeSelectionHelpers.ts'), 'utf8');

assert(
  appSource.includes('buildStartModeSelectionCommit'),
  'App imports and uses buildStartModeSelectionCommit',
);
assert(
  !appSource.includes('startPosition: { x: Math.round(origin.x), y: Math.round(origin.y) }'),
  'App no longer builds rounded startPosition inline',
);
assert(
  !appSource.includes("if (mode !== 'savedOrigin')"),
  'App no longer carries the saved-origin WCS reset branch inline',
);
assert(
  helperSource.includes('T2-6 Phase 3ad'),
  'appStartModeSelectionHelpers carries the T2-6 Phase 3ad marker',
);

console.log('Start-mode scene update and WCS-reset decision are extracted from App.');
