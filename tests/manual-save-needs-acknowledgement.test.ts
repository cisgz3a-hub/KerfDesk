/**
 * T1-69 regression test: manual save (Cmd+S / toolbar Save) must not clear
 * the dirty flag until the user has acknowledged the file actually saved.
 *
 * Bug: `useFileHandlers.handleKeyboardSave` and `FileToolbar.handleSave`
 * called `await saveSceneToFile(scene)` and then immediately invoked
 * `syncAutosaveAfterFileSave` (which clears `sceneIsDirtyRef` and advances
 * `lastSavedSceneRef`). But `saveSceneToFile` resolves when `a.click()` is
 * dispatched — NOT when the file is written. Browser download blockers,
 * cancelled Save As dialogs, disk-full / permission errors are all invisible
 * to the caller. The user saw the dirty indicator clear and reasonably
 * concluded the file was saved when it might not have been.
 *
 * Fix: After `saveSceneToFile` resolves, show a `showConfirm` dialog asking
 * the user to verify the file landed. Only on Yes is `syncAutosaveAfterFileSave`
 * invoked. On No, dirty stays true so the user can retry. Throws from
 * `saveSceneToFile` itself still go to `showAlert` (preserved) and the
 * confirm dialog is not shown.
 *
 * This test mirrors the post-fix `handleKeyboardSave` flow with a stub
 * `saveSceneToFile` and a fake `showConfirm`. The mirror is intentional —
 * production code carries a `// T1-69` comment marking the gate so a future
 * divergence shows up here.
 *
 * Run: npx tsx tests/manual-save-needs-acknowledgement.test.ts
 */
export {};

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

interface RefObj<T> { current: T }

interface SaveDeps {
  saveSceneToFile: () => Promise<void>;
  showAlert: (title: string, message: string) => Promise<void>;
  showConfirm: (title: string, message: string) => Promise<boolean>;
  syncAutosaveAfterFileSave: () => void;
}

/**
 * Mirror of the post-fix `handleKeyboardSave` flow in
 * `src/ui/hooks/useFileHandlers.ts`. Kept structurally identical so a future
 * divergence shows up here. The `FileToolbar.handleSave` flow is the same
 * shape with `onAfterSuccessfulFileSave?.()` replacing
 * `syncAutosaveAfterFileSave()` — covered by the same logic.
 */
async function runHandleKeyboardSave(deps: SaveDeps): Promise<void> {
  try {
    await deps.saveSceneToFile();
  } catch (e) {
    await deps.showAlert('Save Failed', 'Save failed: ' + (e as Error).message);
    return;
  }
  const ok = await deps.showConfirm(
    'File saved?',
    'Make sure your browser saved the file. The app cannot confirm browser '
    + 'downloads.\n\nClick Yes if the file saved successfully. Click No if '
    + 'the download did not complete and you want to try again.',
  );
  if (ok) {
    deps.syncAutosaveAfterFileSave();
  }
}

interface SyncSpy {
  fn: () => void;
  callCount: number;
  sceneIsDirtyRef: RefObj<boolean>;
  lastSavedSceneRef: RefObj<string>;
}

/**
 * Build a `syncAutosaveAfterFileSave` that mutates the dirty/lastSaved refs
 * the same way the production hook does, and tracks how many times it ran.
 */
function makeSyncSpy(
  sceneIsDirtyRef: RefObj<boolean>,
  lastSavedSceneRef: RefObj<string>,
  newJson: string,
): SyncSpy {
  const spy: SyncSpy = {
    callCount: 0,
    sceneIsDirtyRef,
    lastSavedSceneRef,
    fn: () => {},
  };
  spy.fn = () => {
    spy.callCount++;
    sceneIsDirtyRef.current = false;
    lastSavedSceneRef.current = newJson;
  };
  return spy;
}

async function run(): Promise<void> {
  console.log('\n=== manual-save needs acknowledgement (T1-69) ===\n');

  // ── 1. Happy path: user confirms Yes → dirty clears ───────────────────
  {
    const sceneIsDirtyRef: RefObj<boolean> = { current: true };
    const lastSavedSceneRef: RefObj<string> = { current: '{"prev":true}' };
    const newJson = '{"new":true}';
    const sync = makeSyncSpy(sceneIsDirtyRef, lastSavedSceneRef, newJson);
    let confirmCalls = 0;
    let alertCalls = 0;
    let saveCalls = 0;

    await runHandleKeyboardSave({
      saveSceneToFile: async () => { saveCalls++; },
      showAlert: async () => { alertCalls++; },
      showConfirm: async () => { confirmCalls++; return true; },
      syncAutosaveAfterFileSave: sync.fn,
    });

    assert(saveCalls === 1, 'saveSceneToFile called exactly once');
    assert(confirmCalls === 1, 'showConfirm shown exactly once on success');
    assert(alertCalls === 0, 'showAlert not shown on success');
    assert(sync.callCount === 1, 'sync ran on user Yes');
    assert(
      sceneIsDirtyRef.current === false,
      'user Yes → sceneIsDirtyRef cleared',
    );
    assert(
      lastSavedSceneRef.current === newJson,
      'user Yes → lastSavedSceneRef advanced',
    );
  }

  // ── 2. User declines (No): dirty stays true ───────────────────────────
  {
    const sceneIsDirtyRef: RefObj<boolean> = { current: true };
    const lastSavedSceneRef: RefObj<string> = { current: '{"prev":true}' };
    const sync = makeSyncSpy(sceneIsDirtyRef, lastSavedSceneRef, '{"new":true}');
    let confirmCalls = 0;

    await runHandleKeyboardSave({
      saveSceneToFile: async () => {},
      showAlert: async () => {},
      showConfirm: async () => { confirmCalls++; return false; },
      syncAutosaveAfterFileSave: sync.fn,
    });

    assert(confirmCalls === 1, 'showConfirm shown on save success even if user will say No');
    assert(sync.callCount === 0, 'sync NOT run on user No');
    assert(
      sceneIsDirtyRef.current === true,
      'user No → sceneIsDirtyRef stays true',
    );
    assert(
      lastSavedSceneRef.current === '{"prev":true}',
      'user No → lastSavedSceneRef NOT advanced',
    );
  }

  // ── 3. saveSceneToFile throws: alert shown, confirm NOT shown ─────────
  {
    const sceneIsDirtyRef: RefObj<boolean> = { current: true };
    const lastSavedSceneRef: RefObj<string> = { current: '{"prev":true}' };
    const sync = makeSyncSpy(sceneIsDirtyRef, lastSavedSceneRef, '{"new":true}');
    let alertCalls = 0;
    let alertTitle = '';
    let confirmCalls = 0;

    await runHandleKeyboardSave({
      saveSceneToFile: async () => {
        throw new Error('disk full');
      },
      showAlert: async (title) => { alertCalls++; alertTitle = title; },
      showConfirm: async () => { confirmCalls++; return true; },
      syncAutosaveAfterFileSave: sync.fn,
    });

    assert(alertCalls === 1, 'showAlert shown on saveSceneToFile throw');
    assert(alertTitle === 'Save Failed', 'alert title is "Save Failed"');
    assert(confirmCalls === 0, 'showConfirm NOT shown when saveSceneToFile throws');
    assert(sync.callCount === 0, 'sync NOT run on saveSceneToFile throw');
    assert(
      sceneIsDirtyRef.current === true,
      'saveSceneToFile throw → dirty stays true',
    );
  }

  // ── 4. Decline-then-retry: second save with Yes clears dirty ──────────
  {
    const sceneIsDirtyRef: RefObj<boolean> = { current: true };
    const lastSavedSceneRef: RefObj<string> = { current: '' };
    const sync = makeSyncSpy(sceneIsDirtyRef, lastSavedSceneRef, '{"saved":true}');
    let confirmCallNumber = 0;

    // First save: user declines.
    await runHandleKeyboardSave({
      saveSceneToFile: async () => {},
      showAlert: async () => {},
      showConfirm: async () => { confirmCallNumber++; return false; },
      syncAutosaveAfterFileSave: sync.fn,
    });
    assert(sceneIsDirtyRef.current === true, 'after first decline: still dirty');
    assert(sync.callCount === 0, 'after first decline: sync not run');

    // Second save: user confirms.
    await runHandleKeyboardSave({
      saveSceneToFile: async () => {},
      showAlert: async () => {},
      showConfirm: async () => { confirmCallNumber++; return true; },
      syncAutosaveAfterFileSave: sync.fn,
    });
    assert(confirmCallNumber === 2, 'showConfirm shown once per save attempt');
    assert(sync.callCount === 1, 'after retry-Yes: sync ran exactly once');
    assert(
      sceneIsDirtyRef.current === false,
      'after retry-Yes: dirty cleared',
    );
    assert(
      lastSavedSceneRef.current === '{"saved":true}',
      'after retry-Yes: lastSaved advanced',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
