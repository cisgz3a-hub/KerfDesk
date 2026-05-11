/**
 * T1-183 (internal audit F-022): the warnings-confirm dialog must
 * also surface info-severity findings (e.g. LAYER_OUTPUT_SUMMARIES)
 * so the user sees the "what will run" context before approving.
 *
 * Pre-T1-183 evidence (confirmPreflightForJobStart.ts):
 *
 *   preflight.issues
 *     .filter(i => i.severity === 'warning')
 *     .map(i => ...)
 *
 * Info-severity issues were dropped on the floor. The audit flagged
 * this as Low UX: info content (layer summary lines like "1 layer
 * cuts at 2000 mm/min × 75% power, 3 passes") is arguably the most
 * useful confirmation copy, but the user could only see it on the
 * side panel — easy to miss before pressing Start.
 *
 * Post-T1-183: when a warnings dialog is shown, info findings are
 * prepended to the message. The happy-no-warnings path is unchanged
 * (no dialog interruption).
 *
 * Run: npx tsx tests/preflight-confirm-surfaces-info.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { confirmPreflightForJobStart } from '../src/core/preflight/confirmPreflightForJobStart';
import type { PreflightSummary, PreflightIssue } from '../src/core/preflight/Preflight';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));

function makeIssue(severity: 'blocker' | 'warning' | 'info', title: string, detail?: string): PreflightIssue {
  return {
    id: `issue-${title}`,
    severity,
    title,
    detail: detail ?? title,
    category: 'settings',
  };
}

function makeSummary(issues: PreflightIssue[], canStart: boolean): PreflightSummary {
  return {
    canStart,
    blockers: issues.filter(i => i.severity === 'blocker').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
    infos: issues.filter(i => i.severity === 'info').length,
    issues,
  } as unknown as PreflightSummary;
}

console.log('\n=== T1-183 confirm dialog surfaces info findings (audit F-022) ===\n');

void (async () => {
  // -------- 1. Warnings + info: confirm dialog includes BOTH --------
  {
    const summary = makeSummary(
      [
        makeIssue('info', 'Layer output summary', '1 layer cuts at 2000 mm/min × 75% power, 3 passes'),
        makeIssue('warning', 'High cut power', 'Cut power above 80% can ignite material'),
      ],
      true,
    );
    let capturedConfirmMsg = '';
    const showAlert = async (): Promise<void> => {};
    const showConfirm = async (_title: string, msg: string): Promise<boolean> => {
      capturedConfirmMsg = msg;
      return true;
    };
    await confirmPreflightForJobStart(summary, showAlert, showConfirm);
    assert(/Layer output summary/.test(capturedConfirmMsg), 'confirm dialog includes the info title');
    assert(
      /1 layer cuts at 2000 mm\/min/.test(capturedConfirmMsg),
      'confirm dialog includes the info detail',
    );
    assert(/High cut power/.test(capturedConfirmMsg), 'confirm dialog still includes the warning title');
    assert(
      capturedConfirmMsg.indexOf('Layer output summary') < capturedConfirmMsg.indexOf('High cut power'),
      'info appears BEFORE warnings (the "what will run" context comes first)',
    );
    assert(/ℹ/.test(capturedConfirmMsg), 'info findings use the ℹ prefix');
  }

  // -------- 2. Warnings only (no info): dialog unchanged --------
  {
    const summary = makeSummary([makeIssue('warning', 'High cut power')], true);
    let confirmCalled = false;
    let capturedConfirmMsg = '';
    const showAlert = async (): Promise<void> => {};
    const showConfirm = async (_title: string, msg: string): Promise<boolean> => {
      confirmCalled = true;
      capturedConfirmMsg = msg;
      return true;
    };
    await confirmPreflightForJobStart(summary, showAlert, showConfirm);
    assert(confirmCalled, 'warnings only: confirm still fires');
    assert(!/ℹ/.test(capturedConfirmMsg), 'warnings only: no info section (no ℹ prefix)');
    assert(/High cut power/.test(capturedConfirmMsg), 'warning content present');
  }

  // -------- 3. Info only (no warnings, no blockers): no dialog (happy path preserved) --------
  {
    const summary = makeSummary(
      [makeIssue('info', 'Layer output summary', '1 layer cuts at 2000 mm/min')],
      true,
    );
    let confirmCalled = false;
    let alertCalled = false;
    const showAlert = async (): Promise<void> => { alertCalled = true; };
    const showConfirm = async (): Promise<boolean> => { confirmCalled = true; return true; };
    const result = await confirmPreflightForJobStart(summary, showAlert, showConfirm);
    assert(!confirmCalled, 'info only: confirm dialog does NOT fire (happy path preserved)');
    assert(!alertCalled, 'info only: alert does not fire');
    assert(result.confirmed === true, 'info only: starts without interruption');
  }

  // -------- 4. No findings at all: no dialog --------
  {
    const summary = makeSummary([], true);
    let confirmCalled = false;
    const showAlert = async (): Promise<void> => {};
    const showConfirm = async (): Promise<boolean> => { confirmCalled = true; return true; };
    const result = await confirmPreflightForJobStart(summary, showAlert, showConfirm);
    assert(!confirmCalled, 'no findings: no confirm dialog');
    assert(result.confirmed === true, 'no findings: confirmed immediately');
  }

  // -------- 5. Blocker present: alert shown, info NOT shown (blocker dialog unchanged) --------
  {
    const summary = makeSummary(
      [
        makeIssue('blocker', 'Out of bounds', 'Job extends past bed'),
        makeIssue('info', 'Layer output summary'),
      ],
      false,
    );
    let alertMsg = '';
    const showAlert = async (_title: string, msg: string): Promise<void> => { alertMsg = msg; };
    const showConfirm = async (): Promise<boolean> => true;
    const result = await confirmPreflightForJobStart(summary, showAlert, showConfirm);
    assert(/Out of bounds/.test(alertMsg), 'blocker dialog shows the blocker title');
    assert(
      !/Layer output summary/.test(alertMsg),
      'blocker dialog does NOT surface info (focused on the blocker)',
    );
    assert(result.confirmed === false, 'blocker dialog refuses start');
  }

  // -------- 6. Source pins on the implementation --------
  {
    const src = readFileSync(resolve(here, '../src/core/preflight/confirmPreflightForJobStart.ts'), 'utf-8');
    assert(/T1-183/.test(src), 'confirmPreflightForJobStart carries T1-183 marker');
    assert(/audit F-022/.test(src), 'confirmPreflightForJobStart cross-references audit F-022');
    assert(
      /i\.severity === 'info'/.test(src),
      'confirmPreflightForJobStart now filters info-severity issues',
    );
    // The info section must be prepended to the warnings text in the
    // dialog message construction.
    assert(
      /\$\{infoText\}\$\{preflight\.warnings\}/.test(src),
      'info section is prepended to the warnings line in the message',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
