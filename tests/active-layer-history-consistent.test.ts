/**
 * T1-76: canvas-click-to-activate-layer (App.tsx handleActivateLayer)
 * must route through handleSceneCommit, not handleSceneChange. Pairs
 * the LayerPanel.tsx:157 onSceneCommit path so both UI surfaces produce
 * a history entry for the same conceptual action.
 *
 * Source-level pin (App.tsx is too heavy to mount + drive a
 * canvas-click event in the test runner). Asserts the handler shape so
 * a future refactor cannot silently revert to the no-history path.
 *
 * Run: npx tsx tests/active-layer-history-consistent.test.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appTsxPath = resolve(here, '../src/ui/components/App.tsx');
const appTsx = readFileSync(appTsxPath, 'utf-8');
const sceneCommitActionsPath = resolve(here, '../src/ui/scene/SceneCommitActions.ts');
const sceneCommitActions = readFileSync(sceneCommitActionsPath, 'utf-8');
const layerPanelPath = resolve(here, '../src/ui/components/LayerPanel.tsx');
const layerPanel = readFileSync(layerPanelPath, 'utf-8');

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

console.log('\n=== T1-76 active-layer history consistency ===\n');

// Locate the handleActivateLayer body in App.tsx so the asserts run on
// just that function rather than scanning the whole file (which has
// many unrelated handleSceneChange / handleSceneCommit calls).
const handlerStart = appTsx.indexOf('const handleActivateLayer');
assert(handlerStart >= 0, 'handleActivateLayer is defined in App.tsx');
// Find the next `, [` (dependency array start) after the body — the
// useCallback's closing.
const handlerEnd = appTsx.indexOf('}, [', handlerStart);
assert(handlerEnd > handlerStart, 'handleActivateLayer body terminates in App.tsx');
const handlerBody = appTsx.slice(handlerStart, handlerEnd);

assert(
  handlerBody.includes('handleSceneCommit('),
  'handleActivateLayer routes through handleSceneCommit (history entry)',
);
assert(
  !/\bhandleSceneChange\(/.test(handlerBody),
  'handleActivateLayer does NOT call handleSceneChange (no-history path closed)',
);
assert(
  handlerBody.includes("'activate-layer'"),
  "handleActivateLayer passes 'activate-layer' as the SceneCommitAction label",
);
assert(
  handlerBody.includes('T1-76'),
  'handleActivateLayer carries a T1-76 marker for grep discoverability',
);

assert(
  /\|\s*'activate-layer'/.test(sceneCommitActions),
  "SceneCommitAction union includes 'activate-layer'",
);

// LayerPanel's existing path is the unchanged baseline this PR aligns
// to. Pin it here so future churn doesn't drift the LayerPanel side
// off `onSceneCommit` and re-introduce the asymmetry.
assert(
  /onSceneCommit\(\{\s*\.\.\.scene,\s*activeLayerId:\s*layerId\s*\}\)/.test(layerPanel),
  'LayerPanel still routes activeLayerId change through onSceneCommit',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
