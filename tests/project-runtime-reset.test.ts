/**
 * T2-55: transactional resetProjectRuntimeState. Pre-T2-55
 * handleNewProject cleared scene/history/selection only —
 * compile state, toolpath preview, active-job overlay leaked
 * across project boundaries.
 *
 * Run: npx tsx tests/project-runtime-reset.test.ts
 */
import {
  RESET_STEP_ORDER,
  resetProjectRuntimeState,
  profileSwitchTriggersReset,
  describeResetReport,
  type ProjectRuntimeResetters,
  type ResetTrigger,
  type ResetStep,
} from '../src/app/ProjectRuntimeReset';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-55 ProjectRuntime reset ===\n');

const makeResetters = (): { resetters: ProjectRuntimeResetters; calls: ResetStep[] } => {
  const calls: ResetStep[] = [];
  const resetters: ProjectRuntimeResetters = {
    resetHistory: () => { calls.push('resetHistory'); },
    clearSelection: () => { calls.push('clearSelection'); },
    resetCompileState: () => { calls.push('resetCompileState'); },
    hideToolpathPreview: () => { calls.push('hideToolpathPreview'); },
    clearActiveJobOverlay: () => { calls.push('clearActiveJobOverlay'); },
    clearTextPlacement: () => { calls.push('clearTextPlacement'); },
    closeTransientDialogs: () => { calls.push('closeTransientDialogs'); },
    clearToastSuggestion: () => { calls.push('clearToastSuggestion'); },
    clearJobSession: () => { calls.push('clearJobSession'); },
  };
  return { resetters, calls };
};

void (async () => {

// 1. RESET_STEP_ORDER lists 9 steps
{
  assert(RESET_STEP_ORDER.length === 9, `9 reset steps`);
}

// 2. Every step is unique
{
  const set = new Set<ResetStep>(RESET_STEP_ORDER);
  assert(set.size === RESET_STEP_ORDER.length, `no duplicate steps`);
}

// 3. resetProjectRuntimeState fires every step exactly once
{
  const { resetters, calls } = makeResetters();
  const report = resetProjectRuntimeState('new-project', resetters);
  assert(calls.length === 9, `9 calls`);
  assert(report.stepsCompleted.length === 9, `report 9 completed`);
  assert(report.errors.length === 0, `no errors`);
}

// 4. Steps fire in canonical order
{
  const { resetters, calls } = makeResetters();
  resetProjectRuntimeState('new-project', resetters);
  for (let i = 0; i < RESET_STEP_ORDER.length; i++) {
    assert(calls[i] === RESET_STEP_ORDER[i], `step ${i} = ${RESET_STEP_ORDER[i]}`);
  }
}

// 5. Audit's headline: every audit-listed gap is in the contract
{
  // Audit named: clearJobSession, clearActiveJobOverlay, hideToolpathPreview,
  //              resetCompileState, clearTextPlacement, closeTransientDialogs,
  //              clearToastSuggestion. Plus: history, selection.
  const expected: ResetStep[] = [
    'clearJobSession', 'clearActiveJobOverlay', 'hideToolpathPreview',
    'resetCompileState', 'clearTextPlacement', 'clearSelection',
    'resetHistory', 'closeTransientDialogs', 'clearToastSuggestion',
  ];
  for (const s of expected) {
    assert(RESET_STEP_ORDER.includes(s), `step '${s}' in canonical order`);
  }
}

// 6. clearJobSession fires FIRST (release oldest references)
{
  const { resetters, calls } = makeResetters();
  resetProjectRuntimeState('new-project', resetters);
  assert(calls[0] === 'clearJobSession', `clearJobSession first`);
}

// 7. trigger preserved in report
{
  const triggers: ResetTrigger[] = [
    'new-project', 'recover', 'open-file', 'template-load',
    'profile-switch-machine-changed', 'profile-switch-cosmetic',
    'crash-recovery',
  ];
  for (const t of triggers) {
    const { resetters } = makeResetters();
    const report = resetProjectRuntimeState(t, resetters);
    assert(report.trigger === t, `trigger '${t}' preserved`);
  }
}

// 8. throwing resetter recorded but later steps still fire
{
  const calls: ResetStep[] = [];
  const resetters: ProjectRuntimeResetters = {
    resetHistory: () => { calls.push('resetHistory'); },
    clearSelection: () => { calls.push('clearSelection'); },
    resetCompileState: () => { throw new Error('compile reset failed'); },
    hideToolpathPreview: () => { calls.push('hideToolpathPreview'); },
    clearActiveJobOverlay: () => { calls.push('clearActiveJobOverlay'); },
    clearTextPlacement: () => { calls.push('clearTextPlacement'); },
    closeTransientDialogs: () => { calls.push('closeTransientDialogs'); },
    clearToastSuggestion: () => { calls.push('clearToastSuggestion'); },
    clearJobSession: () => { calls.push('clearJobSession'); },
  };
  const report = resetProjectRuntimeState('new-project', resetters);
  assert(report.errors.length === 1, `1 error`);
  assert(report.errors[0].step === 'resetCompileState', `error step recorded`);
  assert(report.errors[0].error.message === 'compile reset failed', `message preserved`);
  assert(report.stepsCompleted.length === 8, `8 succeeded (skipping the one that threw)`);
}

// 9. profileSwitchTriggersReset: bedWidth changed → true
{
  assert(profileSwitchTriggersReset({ bedWidthChanged: true, bedHeightChanged: false, originCornerChanged: false }),
    `bed width change → reset`);
}

// 10. profileSwitchTriggersReset: bedHeight changed → true
{
  assert(profileSwitchTriggersReset({ bedWidthChanged: false, bedHeightChanged: true, originCornerChanged: false }),
    `bed height change → reset`);
}

// 11. profileSwitchTriggersReset: originCorner changed → true
{
  assert(profileSwitchTriggersReset({ bedWidthChanged: false, bedHeightChanged: false, originCornerChanged: true }),
    `corner change → reset`);
}

// 12. profileSwitchTriggersReset: cosmetic only → false
{
  assert(!profileSwitchTriggersReset({ bedWidthChanged: false, bedHeightChanged: false, originCornerChanged: false }),
    `cosmetic only → no reset`);
}

// 13. describeResetReport: clean run
{
  const { resetters } = makeResetters();
  const report = resetProjectRuntimeState('new-project', resetters);
  const msg = describeResetReport(report);
  assert(msg.includes('9/9'), `9/9 in summary`);
  assert(msg.includes('new-project'), `trigger named`);
  assert(msg.includes('OK'), `OK marker`);
}

// 14. describeResetReport: errors listed
{
  const calls: ResetStep[] = [];
  const resetters: ProjectRuntimeResetters = {
    resetHistory: () => { throw new Error('history boom'); },
    clearSelection: () => { calls.push('clearSelection'); },
    resetCompileState: () => { calls.push('resetCompileState'); },
    hideToolpathPreview: () => { calls.push('hideToolpathPreview'); },
    clearActiveJobOverlay: () => { calls.push('clearActiveJobOverlay'); },
    clearTextPlacement: () => { calls.push('clearTextPlacement'); },
    closeTransientDialogs: () => { calls.push('closeTransientDialogs'); },
    clearToastSuggestion: () => { calls.push('clearToastSuggestion'); },
    clearJobSession: () => { calls.push('clearJobSession'); },
  };
  const report = resetProjectRuntimeState('crash-recovery', resetters);
  const msg = describeResetReport(report);
  assert(msg.includes('failed'), `'failed' in summary`);
  assert(msg.includes('resetHistory'), `failing step named`);
}

// 15. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/ProjectRuntimeReset.ts'), 'utf-8');
  assert(/T2-55/.test(src), 'T2-55 marker');
  for (const id of [
    'ResetTrigger', 'ProjectRuntimeResetters',
    'RESET_STEP_ORDER', 'ResetStep', 'ResetReport',
    'resetProjectRuntimeState',
    'profileSwitchTriggersReset', 'describeResetReport',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const t of ['new-project', 'recover', 'open-file', 'template-load',
                   'profile-switch-machine-changed', 'profile-switch-cosmetic',
                   'crash-recovery']) {
    assert(src.includes(`'${t}'`), `trigger '${t}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
