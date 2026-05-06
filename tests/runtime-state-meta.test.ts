/**
 * T2-84: system-level RuntimeState meta-container. Pre-T2-84 runtime
 * state was scattered across App.tsx + 7 other files; cross-cutting
 * consumers had to wire through 8 different hooks/refs.
 *
 * Run: npx tsx tests/runtime-state-meta.test.ts
 */
import {
  buildInitialRuntimeState,
  RuntimeStateStore,
  initialProjectState,
  initialEditorState,
  initialPersistenceState,
  initialFrameState,
  readinessFor,
  canStartJob,
  type RuntimeState,
  type RuntimeReadiness,
} from '../src/runtime/RuntimeState';
import { compiledJobStateInitial } from '../src/app/CompiledJobState';
import { safetyStateInitial } from '../src/app/SafetyStateMachine';
import { jobPhaseInitial } from '../src/app/JobSession';
import { recoveryStateInitial } from '../src/runtime/RecoveryState';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-84 RuntimeState meta-container ===\n');

const initial = (): RuntimeState =>
  buildInitialRuntimeState({
    compile: compiledJobStateInitial,
    machine: safetyStateInitial,
    job: jobPhaseInitial,
    recovery: recoveryStateInitial,
  });

void (async () => {

// 1. initialProjectState shape
{
  assert(initialProjectState.sceneHash === null, `sceneHash null`);
  assert(initialProjectState.profileId === null, `profileId null`);
  assert(initialProjectState.objectCount === 0, `objectCount 0`);
}

// 2. initialEditorState shape
{
  assert(initialEditorState.selectionCount === 0, `selectionCount 0`);
  assert(!initialEditorState.hasOpenDialog, `no open dialog`);
  assert(initialEditorState.viewportZoom === 1, `zoom=1`);
}

// 3. initialPersistenceState shape
{
  assert(initialPersistenceState.status === 'clean', `clean`);
  assert(initialPersistenceState.lastSavedAt === null, `null lastSavedAt`);
  assert(initialPersistenceState.autosaveEnabled, `autosave enabled`);
}

// 4. initialFrameState shape
{
  assert(initialFrameState.status === 'unframed', `unframed`);
  assert(initialFrameState.framedAt === null, `framedAt null`);
}

// 5. buildInitialRuntimeState composes constituent initial states
{
  const r = initial();
  assert(r.project === initialProjectState, `project initial`);
  assert(r.editor === initialEditorState, `editor initial`);
  assert(r.persistence === initialPersistenceState, `persistence initial`);
  assert(r.frame === initialFrameState, `frame initial`);
  assert(r.compile === compiledJobStateInitial, `compile initial`);
  assert(r.machine === safetyStateInitial, `machine initial`);
  assert(r.job === jobPhaseInitial, `job initial`);
  assert(r.recovery === recoveryStateInitial, `recovery initial`);
}

// 6. RuntimeStateStore: getSnapshot returns the seeded state
{
  const store = new RuntimeStateStore(initial());
  assert(store.getSnapshot().machine === safetyStateInitial, `snapshot OK`);
}

// 7. update: changes a slot + identity changes
{
  const store = new RuntimeStateStore(initial());
  const before = store.getSnapshot();
  const changed = store.update('editor', { selectionCount: 5, hasOpenDialog: false, viewportZoom: 2 });
  assert(changed, `returned changed=true`);
  assert(store.getSnapshot() !== before, `snapshot identity changed`);
  assert(store.getSnapshot().editor.selectionCount === 5, `editor mutated`);
}

// 8. update: same value → no-op (returns false, no notify)
{
  const store = new RuntimeStateStore(initial());
  let calls = 0;
  store.subscribe(() => { calls++; });
  const changed = store.update('editor', initialEditorState);  // same identity
  assert(!changed, `same value returns false`);
  assert(calls === 0, `no listener call on no-op`);
}

// 9. updateMany: batched multi-slot update fires once
{
  const store = new RuntimeStateStore(initial());
  let calls = 0;
  store.subscribe(() => { calls++; });
  const changed = store.updateMany({
    editor: { selectionCount: 1, hasOpenDialog: true, viewportZoom: 1 },
    project: { ...initialProjectState, sceneHash: 'sh1' },
  });
  assert(changed, `changed=true`);
  assert(calls === 1, `single notify for batch`);
  assert(store.getSnapshot().project.sceneHash === 'sh1', `project updated`);
  assert(store.getSnapshot().editor.selectionCount === 1, `editor updated`);
}

// 10. updateMany: no-op slots ignored
{
  const store = new RuntimeStateStore(initial());
  const changed = store.updateMany({
    editor: initialEditorState,    // same identity
    project: initialProjectState,  // same identity
  });
  assert(!changed, `no real change → false`);
}

// 11. subscribe + unsubscribe
{
  const store = new RuntimeStateStore(initial());
  let calls = 0;
  const unsub = store.subscribe(() => { calls++; });
  store.update('editor', { ...initialEditorState, selectionCount: 1 });
  assert(calls === 1, `1 call`);
  unsub();
  store.update('editor', { ...initialEditorState, selectionCount: 2 });
  assert(calls === 1, `unsub stopped`);
}

// 12. listener exception isolation
{
  const store = new RuntimeStateStore(initial());
  let goodCalls = 0;
  store.subscribe(() => { throw new Error('bad'); });
  store.subscribe(() => { goodCalls++; });
  store.update('editor', { ...initialEditorState, selectionCount: 7 });
  assert(goodCalls === 1, `good listener still fires`);
}

// 13. listenerCount diagnostic
{
  const store = new RuntimeStateStore(initial());
  assert(store.listenerCount() === 0, `0`);
  const u1 = store.subscribe(() => {});
  const u2 = store.subscribe(() => {});
  assert(store.listenerCount() === 2, `2`);
  u1();
  assert(store.listenerCount() === 1, `1`);
  u2();
}

// 14. readinessFor: no-project (sceneHash null)
{
  assert(readinessFor(initial()) === 'no-project', `null sceneHash → no-project`);
}

// 15. readinessFor: project-loaded (compile not ready)
{
  const r = initial();
  const r2: RuntimeState = {
    ...r,
    project: { ...r.project, sceneHash: 'sh1' },
  };
  assert(readinessFor(r2) === 'project-loaded', `compile not ready → project-loaded`);
}

// 16. readinessFor: compile-ready (frame not framed)
{
  const r = initial();
  const r2: RuntimeState = {
    ...r,
    project: { ...r.project, sceneHash: 'sh1' },
    compile: { status: 'ready', requestId: 1, sceneHash: 'sh1', profileHash: 'ph1', compiledAt: 100, result: { gcode: 'G21', machinePlanBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, ticket: { ticketId: 't1' } } },
  };
  assert(readinessFor(r2) === 'compile-ready', `compile ready, frame unframed → compile-ready`);
}

// 17. readinessFor: frame-ready (recovery non-none)
{
  const r: RuntimeState = {
    ...initial(),
    project: { ...initialProjectState, sceneHash: 'sh1' },
    compile: { status: 'ready', requestId: 1, sceneHash: 'sh1', profileHash: 'ph1', compiledAt: 100, result: { gcode: 'G21', machinePlanBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, ticket: { ticketId: 't1' } } },
    frame: { status: 'framed', framedAt: 1000 },
    recovery: { status: 'alarm', alarmCode: 1, occurredAt: 100, requiresRehome: false, inspectionDone: false, unlockDone: false, rehomeDone: false, reframeDone: false },
  };
  assert(readinessFor(r) === 'frame-ready', `compile+frame ok, recovery active → frame-ready`);
}

// 18. readinessFor: job-ready (everything aligned)
{
  const r: RuntimeState = {
    ...initial(),
    project: { ...initialProjectState, sceneHash: 'sh1' },
    compile: { status: 'ready', requestId: 1, sceneHash: 'sh1', profileHash: 'ph1', compiledAt: 100, result: { gcode: 'G21', machinePlanBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, ticket: { ticketId: 't1' } } },
    frame: { status: 'framed', framedAt: 1000 },
  };
  assert(readinessFor(r) === 'job-ready', `all clean → job-ready`);
}

// 19. canStartJob: only true when readiness === 'job-ready'
{
  const noProject = initial();
  assert(!canStartJob(noProject), `no project → false`);
  const ready: RuntimeState = {
    ...initial(),
    project: { ...initialProjectState, sceneHash: 'sh1' },
    compile: { status: 'ready', requestId: 1, sceneHash: 'sh1', profileHash: 'ph1', compiledAt: 100, result: { gcode: 'G21', machinePlanBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, ticket: { ticketId: 't1' } } },
    frame: { status: 'framed', framedAt: 1000 },
  };
  assert(canStartJob(ready), `all clean → true`);
}

// 20. THE audit's headline: 8 readiness slots composed in one container
{
  const r = initial();
  const slotCount = Object.keys(r).length;
  assert(slotCount === 8, `8 slots: project+editor+compile+frame+machine+job+recovery+persistence`);
}

// 21. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/runtime/RuntimeState.ts'), 'utf-8');
  assert(/T2-84/.test(src), 'T2-84 marker');
  for (const id of [
    'ProjectState', 'EditorState', 'PersistenceState', 'PersistenceStatus',
    'FrameStateLike', 'RuntimeState',
    'initialProjectState', 'initialEditorState',
    'initialPersistenceState', 'initialFrameState',
    'buildInitialRuntimeState', 'RuntimeStateStore',
    'RuntimeReadiness', 'readinessFor', 'canStartJob',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const r of ['no-project', 'project-loaded', 'compile-ready', 'frame-ready', 'job-ready']) {
    assert(src.includes(`'${r}'`), `readiness '${r}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
