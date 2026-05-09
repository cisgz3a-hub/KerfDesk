/**
 * T3-68: debug state graph + named transition log.
 *
 * Run: npx tsx tests/debug-state-graph-transition-log.test.ts
 */
import { readFileSync } from 'node:fs';
import {
  TransitionLog,
  transitionFromSceneTransaction,
  type StateTransition,
} from '../src/debug/TransitionLog';
import { installDebugStateGraph } from '../src/debug/StateGraph';

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  not ok - ${message}`);
  }
}

console.log('\n=== T3-68 debug state graph + transition log ===\n');

{
  const log = new TransitionLog(2);
  let notifications = 0;
  const unsubscribe = log.subscribe(() => { notifications++; });

  const first: StateTransition = { event: 'PROJECT_LOADED', sceneHash: 'a', source: 'file', at: 1 };
  const second: StateTransition = { event: 'SCENE_COMMITTED', sceneHash: 'b', action: 'paste', at: 2 };
  const third: StateTransition = { event: 'COMPILE_STARTED', requestId: 3, sceneHash: 'b', profileHash: 'p', at: 3 };
  log.emit(first);
  log.emit(second);
  log.emit(third);

  const snapshot = log.getSnapshot();
  assert(snapshot.length === 2, 'transition log enforces bounded capacity');
  assert(snapshot[0] === second && snapshot[1] === third, 'transition log evicts oldest entries first');
  assert(notifications === 3, 'transition log notifies once per emit');

  unsubscribe();
  log.emit({ event: 'COMPILE_READY', requestId: 3, durationMs: 25, at: 4 });
  assert(notifications === 3, 'unsubscribe stops transition notifications');
  log.clear();
  assert(log.getSnapshot().length === 0, 'transition log clear removes entries');
}

{
  const edit = transitionFromSceneTransaction({
    event: 'SCENE_TRANSACTION',
    reason: { kind: 'edit', action: 'delete' },
    ts: 100,
  });
  const load = transitionFromSceneTransaction({
    event: 'SCENE_TRANSACTION',
    reason: { kind: 'load', source: 'autosave' },
    ts: 200,
  });
  const preview = transitionFromSceneTransaction({
    event: 'SCENE_TRANSACTION',
    reason: { kind: 'preview' },
    ts: 300,
  });

  assert(edit.event === 'SCENE_COMMITTED' && edit.action === 'delete' && edit.at === 100, 'edit transaction maps to named SCENE_COMMITTED event');
  assert(load.event === 'PROJECT_LOADED' && load.source === 'autosave' && load.at === 200, 'load transaction maps to named PROJECT_LOADED event');
  assert(preview.event === 'SCENE_PREVIEWED' && preview.at === 300, 'preview transaction maps to named SCENE_PREVIEWED event');
}

{
  let projectCount = 1;
  const target: Record<string, unknown> = {};
  const installed = installDebugStateGraph(
    {
      project: { getSnapshot: () => ({ count: projectCount }) },
      editor: { getSnapshot: () => ({ selectionCount: 0 }) },
    },
    { target, dev: true },
  );
  assert(installed, 'debug state graph installs in dev mode');
  const state1 = target.__LASERFORGE_STATE__ as { project: { count: number } };
  assert(state1.project.count === 1, 'debug state graph getter returns store snapshot');
  projectCount = 2;
  const state2 = target.__LASERFORGE_STATE__ as { project: { count: number } };
  assert(state2.project.count === 2, 'debug state graph getter stays live');

  const prodTarget: Record<string, unknown> = {};
  const prodInstalled = installDebugStateGraph(
    { project: { getSnapshot: () => ({ count: 1 }) } },
    { target: prodTarget, dev: false },
  );
  assert(!prodInstalled, 'debug state graph does not install in production mode');
  assert(!('__LASERFORGE_STATE__' in prodTarget), 'production target has no debug state global');
}

{
  const appSource = readFileSync('src/ui/components/App.tsx', 'utf-8');
  assert(appSource.includes('transitionFromSceneTransaction'), 'App wires scene transactions into named transition log');
  assert(appSource.includes('installAppDebugStateGraph'), 'App installs the debug state graph in development');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
