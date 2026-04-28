/**
 * T2-76 unit tests for `makeCommitSceneTransaction`.
 *
 * Verifies the pure-function dispatch logic without any React or App.tsx
 * machinery. Spy deps record every call; each sub-test asserts the
 * expected sequence and side-effects for one scenario.
 *
 * Step 1 of 8 of the T2-76 migration. Until later steps wire the
 * function into App.tsx and migrate callers, this is the only consumer.
 *
 * Run: npx tsx tests/scene-transaction-unified.test.ts
 */
import {
  makeCommitSceneTransaction,
  type SceneTransactionDeps,
  type SceneTransactionLogEvent,
  type HistoryEntryMetaForward,
} from '../src/ui/scene/SceneTransaction';
import { createScene } from '../src/core/scene/Scene';
import type { Scene } from '../src/core/scene/Scene';

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

interface CallSpy<TArgs extends unknown[]> {
  calls: TArgs[];
  fn: (...args: TArgs) => void;
}

function spy<TArgs extends unknown[]>(): CallSpy<TArgs> {
  const calls: TArgs[] = [];
  const fn = (...args: TArgs) => {
    calls.push(args);
  };
  return { calls, fn };
}

interface SpyDeps {
  setScene: CallSpy<[Scene]>;
  // T2-78: push/reset now receive an optional meta payload alongside
  // the scene. Spy widens to capture both args; existing assertions
  // that index calls[i][0] for the scene continue to work.
  historyPush: CallSpy<[Scene, HistoryEntryMetaForward?]>;
  historyReset: CallSpy<[Scene, HistoryEntryMetaForward?]>;
  setSelectedIds: CallSpy<[Set<string>]>;
  notifyDirty: CallSpy<[boolean]>;
  invalidateCompile: CallSpy<[]>;
  invalidateFrame: CallSpy<[]>;
  invalidatePreflight: CallSpy<[]>;
  logEmit: CallSpy<[SceneTransactionLogEvent]>;
  /**
   * T2-78: tracks every getSelection() read so tests can verify the
   * dispatcher consults selection state when constructing history entries.
   */
  getSelectionReads: number;
  deps: SceneTransactionDeps;
  /** Pass deps WITHOUT the transition log (mimics pre-T3-68 wiring). */
  depsWithoutLog: SceneTransactionDeps;
}

function makeSpyDeps(): SpyDeps {
  const setScene = spy<[Scene]>();
  const historyPush = spy<[Scene, HistoryEntryMetaForward?]>();
  const historyReset = spy<[Scene, HistoryEntryMetaForward?]>();
  const setSelectedIds = spy<[Set<string>]>();
  const notifyDirty = spy<[boolean]>();
  const invalidateCompile = spy<[]>();
  const invalidateFrame = spy<[]>();
  const invalidatePreflight = spy<[]>();
  const logEmit = spy<[SceneTransactionLogEvent]>();

  // T2-78: tracker object so callers can mutate the read count from
  // the getSelection lambda. Returned as a value-by-reference field.
  const tracker = { getSelectionReads: 0 };
  const getSelection = (): ReadonlySet<string> => {
    tracker.getSelectionReads++;
    return new Set();
  };

  const baseDeps: SceneTransactionDeps = {
    setScene: setScene.fn,
    history: { push: historyPush.fn, reset: historyReset.fn },
    setSelectedIds: setSelectedIds.fn,
    notifyDirty: notifyDirty.fn,
    getSelection,
    invalidate: {
      compile: invalidateCompile.fn,
      frame: invalidateFrame.fn,
      preflight: invalidatePreflight.fn,
    },
  };

  return {
    setScene,
    historyPush,
    historyReset,
    setSelectedIds,
    notifyDirty,
    invalidateCompile,
    invalidateFrame,
    invalidatePreflight,
    logEmit,
    get getSelectionReads() { return tracker.getSelectionReads; },
    deps: { ...baseDeps, transitionLog: { emit: logEmit.fn } },
    depsWithoutLog: baseDeps,
  };
}

void (async () => {
  console.log('\n=== T2-76 makeCommitSceneTransaction unit tests ===\n');

  const sceneA = createScene(400, 400, 'A');
  const sceneB = createScene(400, 400, 'B');

  // ── 1. preview: setScene only, nothing else ──────────────────────────
  console.log('-- preview reason --');
  {
    const s = makeSpyDeps();
    const fn = makeCommitSceneTransaction(s.deps);
    fn(sceneA, { kind: 'preview' });

    assert(s.setScene.calls.length === 1, 'preview: setScene called once');
    assert(s.setScene.calls[0][0] === sceneA, 'preview: setScene called with the new scene');
    assert(s.historyPush.calls.length === 0, 'preview: history.push NOT called');
    assert(s.historyReset.calls.length === 0, 'preview: history.reset NOT called');
    assert(s.notifyDirty.calls.length === 0, 'preview: notifyDirty NOT called');
    assert(s.invalidateCompile.calls.length === 0, 'preview: invalidate.compile NOT called');
    assert(s.invalidateFrame.calls.length === 0, 'preview: invalidate.frame NOT called');
    assert(s.invalidatePreflight.calls.length === 0, 'preview: invalidate.preflight NOT called');
    assert(s.setSelectedIds.calls.length === 0, 'preview: setSelectedIds NOT called');
    // Transition log fires for every reason, including preview, so
    // debugging/auditing has full visibility.
    assert(s.logEmit.calls.length === 1, 'preview: transitionLog.emit fired (every reason emits)');
  }

  // ── 2. edit: full commit path ────────────────────────────────────────
  console.log('-- edit reason --');
  {
    const s = makeSpyDeps();
    const fn = makeCommitSceneTransaction(s.deps);
    fn(sceneA, { kind: 'edit', action: 'paste' });

    assert(s.setScene.calls.length === 1, 'edit: setScene called once');
    assert(s.historyPush.calls.length === 1, 'edit: history.push called once');
    assert(s.historyReset.calls.length === 0, 'edit: history.reset NOT called');
    assert(s.notifyDirty.calls.length === 1, 'edit: notifyDirty called once');
    assert(s.notifyDirty.calls[0][0] === true, 'edit: notifyDirty called with true');
    assert(s.invalidateCompile.calls.length === 1, 'edit: invalidate.compile called');
    assert(s.invalidateFrame.calls.length === 1, 'edit: invalidate.frame called');
    assert(s.invalidatePreflight.calls.length === 1, 'edit: invalidate.preflight called');
    assert(s.setSelectedIds.calls.length === 0, 'edit: setSelectedIds NOT called (no meta)');
    assert(s.logEmit.calls.length === 1, 'edit: transitionLog.emit fired');

    const event = s.logEmit.calls[0][0];
    assert(event.event === 'SCENE_TRANSACTION', 'edit: log event tag is SCENE_TRANSACTION');
    assert(
      event.reason.kind === 'edit'
      && (event.reason as { kind: 'edit'; action: string }).action === 'paste',
      'edit: log event carries reason kind and action',
    );
    assert(typeof event.ts === 'number' && event.ts > 0, 'edit: log event has timestamp');
  }

  // ── 3. history (undo): setScene without history.push ─────────────────
  console.log('-- history (undo) reason --');
  {
    const s = makeSpyDeps();
    const fn = makeCommitSceneTransaction(s.deps);
    fn(sceneA, { kind: 'history', direction: 'undo' });

    assert(s.setScene.calls.length === 1, 'history: setScene called once');
    assert(s.historyPush.calls.length === 0, 'history: history.push NOT called (cursor already moved)');
    assert(s.historyReset.calls.length === 0, 'history: history.reset NOT called');
    assert(s.notifyDirty.calls.length === 1, 'history: notifyDirty called once');
    assert(s.notifyDirty.calls[0][0] === true, 'history: notifyDirty called with true (T1-75)');
    assert(s.invalidateCompile.calls.length === 1, 'history: invalidate.compile called');
    assert(s.invalidateFrame.calls.length === 1, 'history: invalidate.frame called');
    assert(s.invalidatePreflight.calls.length === 1, 'history: invalidate.preflight called');
    // history without meta.selectionAfter: clear selection (pre-T2-79
    // behavior, no stale IDs).
    assert(s.setSelectedIds.calls.length === 1, 'history (no meta): setSelectedIds called once');
    assert(s.setSelectedIds.calls[0][0].size === 0, 'history (no meta): selection cleared');
  }

  // ── 4. history with selectionAfter (T2-79 forward-compat) ────────────
  console.log('-- history with selectionAfter --');
  {
    const s = makeSpyDeps();
    const fn = makeCommitSceneTransaction(s.deps);
    const selection = new Set(['obj-1', 'obj-2']);
    fn(sceneA, { kind: 'history', direction: 'undo' }, { selectionAfter: selection });

    assert(s.setSelectedIds.calls.length === 1, 'history+meta: setSelectedIds called once');
    const applied = s.setSelectedIds.calls[0][0];
    assert(applied.size === 2, 'history+meta: applied selection has 2 items');
    assert(applied.has('obj-1') && applied.has('obj-2'), 'history+meta: selection contents match');
    assert(applied !== selection, 'history+meta: selection is a fresh Set, not the input ref');
  }

  // ── 5. load (new): history.reset + dirty=false ───────────────────────
  console.log('-- load (new) reason --');
  {
    const s = makeSpyDeps();
    const fn = makeCommitSceneTransaction(s.deps);
    fn(sceneA, { kind: 'load', source: 'new' });

    assert(s.setScene.calls.length === 1, 'load: setScene called once');
    assert(s.historyReset.calls.length === 1, 'load: history.reset called once');
    assert(s.historyPush.calls.length === 0, 'load: history.push NOT called');
    assert(s.notifyDirty.calls.length === 1, 'load: notifyDirty called once');
    assert(s.notifyDirty.calls[0][0] === false, 'load: notifyDirty called with false (loaded == saved)');
    // Loads invalidate by default — fresh scene shouldn't carry stale
    // compile cache from previous project.
    assert(s.invalidateCompile.calls.length === 1, 'load: invalidate.compile called');
    assert(s.invalidateFrame.calls.length === 1, 'load: invalidate.frame called');
    assert(s.invalidatePreflight.calls.length === 1, 'load: invalidate.preflight called');
  }

  // ── 6. async-result: behaves like edit ───────────────────────────────
  console.log('-- async-result reason --');
  {
    const s = makeSpyDeps();
    const fn = makeCommitSceneTransaction(s.deps);
    fn(sceneA, { kind: 'async-result', operation: 'trace', capturedRevisionId: 42 });

    assert(s.setScene.calls.length === 1, 'async-result: setScene called once');
    assert(s.historyPush.calls.length === 1, 'async-result: history.push called once');
    assert(s.historyReset.calls.length === 0, 'async-result: history.reset NOT called');
    assert(s.notifyDirty.calls[0][0] === true, 'async-result: notifyDirty(true)');
    assert(s.invalidateCompile.calls.length === 1, 'async-result: invalidate.compile called');

    const event = s.logEmit.calls[0][0];
    assert(
      event.reason.kind === 'async-result'
      && (event.reason as { kind: 'async-result'; operation: string }).operation === 'trace',
      'async-result: log event carries operation name',
    );
  }

  // ── 7. meta.invalidatesCompile=false overrides default ───────────────
  console.log('-- meta override: skip compile invalidation --');
  {
    const s = makeSpyDeps();
    const fn = makeCommitSceneTransaction(s.deps);
    fn(sceneA, { kind: 'edit', action: 'rename' }, { invalidatesCompile: false });

    assert(s.invalidateCompile.calls.length === 0, 'meta override: invalidate.compile NOT called');
    assert(s.invalidateFrame.calls.length === 1, 'meta override: invalidate.frame still called (default)');
    assert(s.invalidatePreflight.calls.length === 1, 'meta override: invalidate.preflight still called (default)');
  }

  // ── 8. meta override: skip all invalidations ─────────────────────────
  console.log('-- meta override: skip all invalidations --');
  {
    const s = makeSpyDeps();
    const fn = makeCommitSceneTransaction(s.deps);
    fn(sceneA, { kind: 'edit', action: 'metadata-only' }, {
      invalidatesCompile: false,
      invalidatesFrame: false,
      invalidatesPreflight: false,
    });

    assert(s.invalidateCompile.calls.length === 0, 'all-skip: invalidate.compile NOT called');
    assert(s.invalidateFrame.calls.length === 0, 'all-skip: invalidate.frame NOT called');
    assert(s.invalidatePreflight.calls.length === 0, 'all-skip: invalidate.preflight NOT called');
    // Other side-effects still fire.
    assert(s.setScene.calls.length === 1, 'all-skip: setScene still called');
    assert(s.historyPush.calls.length === 1, 'all-skip: history still pushed');
    assert(s.notifyDirty.calls[0][0] === true, 'all-skip: still marked dirty');
  }

  // ── 9. edit with selectionAfter (e.g. delete handler) ────────────────
  console.log('-- edit with selectionAfter (delete pattern) --');
  {
    const s = makeSpyDeps();
    const fn = makeCommitSceneTransaction(s.deps);
    fn(sceneA, { kind: 'edit', action: 'delete' }, { selectionAfter: new Set() });

    assert(s.setSelectedIds.calls.length === 1, 'edit+selectionAfter: setSelectedIds called');
    assert(s.setSelectedIds.calls[0][0].size === 0, 'edit+selectionAfter: selection cleared');
  }

  // ── 10. edit without meta does NOT touch selection ───────────────────
  console.log('-- edit without meta does not touch selection --');
  {
    const s = makeSpyDeps();
    const fn = makeCommitSceneTransaction(s.deps);
    fn(sceneA, { kind: 'edit', action: 'transform' });

    // No setSelectedIds call — caller manages selection themselves
    // (e.g. transform handlers keep the moved object selected).
    assert(s.setSelectedIds.calls.length === 0, 'edit (no meta): setSelectedIds NOT called');
  }

  // ── 11. transitionLog absent: no error, no emission ──────────────────
  console.log('-- transitionLog absent (pre-T3-68 wiring) --');
  {
    const s = makeSpyDeps();
    const fn = makeCommitSceneTransaction(s.depsWithoutLog);
    let threw = false;
    try {
      fn(sceneA, { kind: 'edit', action: 'foo' });
    } catch {
      threw = true;
    }
    assert(!threw, 'no log: function does not throw');
    assert(s.logEmit.calls.length === 0, 'no log: emit NOT called (log not wired)');
    // Other side-effects unaffected.
    assert(s.setScene.calls.length === 1, 'no log: setScene still called');
    assert(s.historyPush.calls.length === 1, 'no log: history still pushed');
  }

  // ── 12. multiple successive transactions accumulate correctly ────────
  console.log('-- multiple transactions accumulate --');
  {
    const s = makeSpyDeps();
    const fn = makeCommitSceneTransaction(s.deps);
    fn(sceneA, { kind: 'edit', action: 'a' });
    fn(sceneB, { kind: 'edit', action: 'b' });
    fn(sceneA, { kind: 'history', direction: 'undo' });

    assert(s.setScene.calls.length === 3, 'multi: setScene called 3 times');
    assert(s.setScene.calls[0][0] === sceneA, 'multi: first setScene with sceneA');
    assert(s.setScene.calls[1][0] === sceneB, 'multi: second setScene with sceneB');
    assert(s.setScene.calls[2][0] === sceneA, 'multi: third setScene with sceneA again');
    assert(s.historyPush.calls.length === 2, 'multi: history.push called twice (edits only)');
    assert(s.notifyDirty.calls.length === 3, 'multi: notifyDirty called 3 times');
    assert(s.notifyDirty.calls.every(c => c[0] === true), 'multi: all notifyDirty calls are true');
    assert(s.logEmit.calls.length === 3, 'multi: log emitted for each transaction');
    assert(s.logEmit.calls[2][0].reason.kind === 'history', 'multi: third log entry is history');
  }

  // ── 13. setScene called BEFORE history operations ────────────────────
  // Ordering matters for downstream subscribers — e.g. an autosave
  // listener watching scene state should see the new scene before any
  // dirty notification arrives, otherwise it could skip writing.
  console.log('-- setScene fires before notifyDirty --');
  {
    const callOrder: string[] = [];
    const fn = makeCommitSceneTransaction({
      setScene: () => { callOrder.push('setScene'); },
      history: { push: () => { callOrder.push('historyPush'); }, reset: () => {} },
      setSelectedIds: () => { callOrder.push('setSelectedIds'); },
      notifyDirty: () => { callOrder.push('notifyDirty'); },
      getSelection: () => new Set(),
      invalidate: {
        compile: () => { callOrder.push('invalidateCompile'); },
        frame: () => { callOrder.push('invalidateFrame'); },
        preflight: () => { callOrder.push('invalidatePreflight'); },
      },
    });
    fn(sceneA, { kind: 'edit', action: 'order-check' });

    assert(callOrder[0] === 'setScene', 'order: setScene fires first');
    assert(callOrder.indexOf('historyPush') < callOrder.indexOf('notifyDirty'),
      'order: history.push fires before notifyDirty');
    assert(callOrder.indexOf('notifyDirty') < callOrder.indexOf('invalidateCompile'),
      'order: notifyDirty fires before invalidate.compile');
  }

  // ── 14. load preserves meta.invalidatesX overrides ───────────────────
  // Edge case: a test scaffold that loads a scene but doesn't want
  // invalidation noise should be able to opt out via meta.
  console.log('-- load + invalidation override --');
  {
    const s = makeSpyDeps();
    const fn = makeCommitSceneTransaction(s.deps);
    fn(sceneA, { kind: 'load', source: 'autosave' }, { invalidatesCompile: false });

    assert(s.historyReset.calls.length === 1, 'load+override: history still reset');
    assert(s.notifyDirty.calls[0][0] === false, 'load+override: still notifyDirty(false)');
    assert(s.invalidateCompile.calls.length === 0, 'load+override: invalidate.compile skipped');
    assert(s.invalidateFrame.calls.length === 1, 'load+override: invalidate.frame still called');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
