/**
 * T2-83: undo / redo are blocked while a job is streaming. Pre-T2-83
 * the user could press Ctrl+Z mid-burn and silently desync the visible
 * scene from what the controller was actually executing. The active
 * job context was already pinned at the compile manager (T2-53 work),
 * but nothing prevented the scene-level handler from running.
 *
 * App.tsx's `handleUndo` / `handleRedo` are wrapped in a heavy React
 * component; pinning them behaviorally would require mounting the
 * full app tree. This test pins the contract via source-level
 * assertions: the isJobRunning guard, the showAlert call with the
 * correct messaging, and that the actual undo/redo only runs when
 * NOT job-running.
 *
 * Run: npx tsx tests/undo-during-job.test.ts
 */
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

console.log('\n=== T2-83 undo/redo blocked during job ===\n');

void (async () => {
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const appSrc = fs.readFileSync(path.resolve(here, '../src/ui/components/App.tsx'), 'utf-8');

  // 1. T2-83 marker present at the undo/redo boundary
  assert(/T2-83/.test(appSrc),
    'T2-83 marker present in App.tsx');

  // 2. handleUndo guards on grbl.isJobRunning
  const undoBlock = appSrc.match(/const handleUndo = useCallback\(\([\s\S]*?\}, \[[^\]]+\]\);/);
  assert(undoBlock != null && /grbl\.isJobRunning/.test(undoBlock[0]),
    'handleUndo body checks grbl.isJobRunning');
  assert(undoBlock != null && /showAlert\(/.test(undoBlock[0]),
    'handleUndo invokes showAlert on job-running path');
  assert(undoBlock != null && /Undo blocked/.test(undoBlock[0]),
    'handleUndo showAlert title is "Undo blocked"');
  assert(undoBlock != null && /\[applyHistoryScene, grbl\.isJobRunning, showAlert\]/.test(undoBlock[0]),
    'handleUndo dep array includes grbl.isJobRunning + showAlert');

  // 3. handleRedo guards on grbl.isJobRunning
  const redoBlock = appSrc.match(/const handleRedo = useCallback\(\([\s\S]*?\}, \[[^\]]+\]\);/);
  assert(redoBlock != null && /grbl\.isJobRunning/.test(redoBlock[0]),
    'handleRedo body checks grbl.isJobRunning');
  assert(redoBlock != null && /Redo blocked/.test(redoBlock[0]),
    'handleRedo showAlert title is "Redo blocked"');
  assert(redoBlock != null && /\[applyHistoryScene, grbl\.isJobRunning, showAlert\]/.test(redoBlock[0]),
    'handleRedo dep array includes grbl.isJobRunning + showAlert');

  // 4. The guard fires BEFORE undoEntry() / redoEntry() — proves we
  //    don't pop history state then refuse to apply (which would lose
  //    the entry).
  if (undoBlock != null) {
    const guardIdx = undoBlock[0].search(/grbl\.isJobRunning/);
    const popIdx = undoBlock[0].search(/\.undoEntry\(\)/);
    assert(guardIdx >= 0 && popIdx >= 0 && guardIdx < popIdx,
      `handleUndo guard runs BEFORE history pop (guard@${guardIdx}, pop@${popIdx})`);
  }
  if (redoBlock != null) {
    const guardIdx = redoBlock[0].search(/grbl\.isJobRunning/);
    const popIdx = redoBlock[0].search(/\.redoEntry\(\)/);
    assert(guardIdx >= 0 && popIdx >= 0 && guardIdx < popIdx,
      `handleRedo guard runs BEFORE history pop (guard@${guardIdx}, pop@${popIdx})`);
  }

  // 5. The user-facing message names the recovery action ("Stop the
  //    job before editing the design") so the user knows what to do.
  assert(/Stop the job before editing the design/.test(appSrc),
    'block message names recovery action');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => { console.error(e); process.exit(1); });
