/**
 * T1-191 (external audit High #2 + #8 surfacing): the preflight
 * confirm dialog must surface burn-envelope divergence (T1-188) to
 * the user BEFORE the standard blocker / warning flow.
 *
 * Pre-T1-191 the divergence was computed (T1-188) and attached to
 * the ticket, but the user had no way to see it — the data lived
 * only in the structured log via console.warn. T1-191 wires the
 * field through to a dedicated confirm dialog: the user reads the
 * mismatch kind + deltas + move counts and explicitly accepts the
 * risk of running output that doesn't match the preview.
 *
 * Design choice (fail-soft, matching T1-188's framing): the dialog
 * is a confirm (proceed / cancel), not a block. The user retains
 * the choice. Future tickets may elevate specific kinds to hard
 * blockers.
 *
 * Run: npx tsx tests/confirm-dialog-surfaces-divergence.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { confirmPreflightForJobStart } from '../src/core/preflight/confirmPreflightForJobStart';
import type { ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import type { PreflightSummary } from '../src/core/preflight/Preflight';
import type { BurnEnvelopeDivergenceReport } from '../src/core/output/burnEnvelopeDivergence';

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

function makeTicket(divergence: BurnEnvelopeDivergenceReport | null): ValidatedJobTicket {
  return {
    ticketId: 't', sceneHash: 's', profileHash: 'p',
    gcodeHash: 'g', entitlementPolicyHash: 'e',
    materialPresetsHash: 'm', emittedBurnBounds: null,
    burnEnvelopeDivergence: divergence,
    gcodeLines: [], gcodeText: '',
    machinePlanBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    machineTransform: {} as never,
    controllerType: 'grbl',
    startMode: 'absolute' as never,
    savedOrigin: null,
    createdAt: Date.now(),
  } as unknown as ValidatedJobTicket;
}

const emptySummary: PreflightSummary = {
  canStart: true, blockers: 0, warnings: 0, infos: 0, issues: [],
} as unknown as PreflightSummary;

console.log('\n=== T1-191 confirm dialog surfaces burn-envelope divergence ===\n');

void (async () => {
  // -------- 1. envelope-edge-mismatch: dedicated confirm shown --------
  {
    const divergence: BurnEnvelopeDivergenceReport = {
      kind: 'envelope-edge-mismatch',
      planBurnBounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
      emittedBurnBounds: { minX: 7, minY: 10, maxX: 23, maxY: 20 },
      maxEdgeDeltaMm: 3.0,
      planBurnMoveCount: 1,
      emittedBurnMoveCount: 1,
      toleranceMm: 0.5,
    };
    let capturedTitle = '';
    let capturedMsg = '';
    let confirmCount = 0;
    const showAlert = async (): Promise<void> => {};
    const showConfirm = async (title: string, msg: string): Promise<boolean> => {
      confirmCount++;
      capturedTitle = title; capturedMsg = msg;
      return true;
    };
    const result = await confirmPreflightForJobStart(
      emptySummary, showAlert, showConfirm, makeTicket(divergence),
    );
    assert(confirmCount === 1, 'edge-mismatch: exactly 1 confirm dialog');
    assert(/Preview ↔ output mismatch/i.test(capturedTitle), 'title names the mismatch');
    assert(/Max edge delta: 3\.000 mm/.test(capturedMsg), 'message includes maxEdgeDeltaMm');
    assert(/tolerance: 0\.5 mm/i.test(capturedMsg), 'message includes the tolerance');
    assert(/Plan burn moves: 1/.test(capturedMsg), 'message includes plan move count');
    assert(/Emitted burn moves: 1/.test(capturedMsg), 'message includes emitted move count');
    assert(/differs from the plan/i.test(capturedMsg), 'message describes the kind');
    assert(/Proceed anyway/i.test(capturedMsg), 'message asks for explicit acceptance');
    assert(result.confirmed === true, 'user accepted → confirmed=true');
  }

  // -------- 2. User cancels → confirmed=false --------
  {
    const divergence: BurnEnvelopeDivergenceReport = {
      kind: 'emitted-empty-plan-non-empty',
      planBurnBounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
      emittedBurnBounds: null,
      maxEdgeDeltaMm: Infinity,
      planBurnMoveCount: 5,
      emittedBurnMoveCount: 0,
      toleranceMm: 0.5,
    };
    const showAlert = async (): Promise<void> => {};
    const showConfirm = async (): Promise<boolean> => false; // user cancels
    const result = await confirmPreflightForJobStart(
      emptySummary, showAlert, showConfirm, makeTicket(divergence),
    );
    assert(result.confirmed === false, 'user cancelled → confirmed=false');
    assert(result.ticket === null, 'cancel: ticket is null');
  }

  // -------- 3. plan-empty-emitted-non-empty: kind label appears --------
  {
    const divergence: BurnEnvelopeDivergenceReport = {
      kind: 'plan-empty-emitted-non-empty',
      planBurnBounds: null,
      emittedBurnBounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
      maxEdgeDeltaMm: Infinity,
      planBurnMoveCount: 0,
      emittedBurnMoveCount: 3,
      toleranceMm: 0.5,
    };
    let capturedMsg = '';
    const showAlert = async (): Promise<void> => {};
    const showConfirm = async (_t: string, msg: string): Promise<boolean> => { capturedMsg = msg; return true; };
    await confirmPreflightForJobStart(
      emptySummary, showAlert, showConfirm, makeTicket(divergence),
    );
    assert(
      /burn moves the plan does not/i.test(capturedMsg),
      'plan-empty-emitted-non-empty: kind label present',
    );
  }

  // -------- 4. No divergence: no dedicated confirm shown --------
  {
    let confirmCount = 0;
    const showAlert = async (): Promise<void> => {};
    const showConfirm = async (): Promise<boolean> => { confirmCount++; return true; };
    const result = await confirmPreflightForJobStart(
      emptySummary, showAlert, showConfirm, makeTicket(null),
    );
    assert(confirmCount === 0, 'no divergence: no divergence confirm fires');
    assert(result.confirmed === true, 'no divergence + no warnings: confirmed without interruption');
  }

  // -------- 5. Source pins --------
  {
    const src = readFileSync(resolve(here, '../src/core/preflight/confirmPreflightForJobStart.ts'), 'utf-8');
    assert(/T1-191/.test(src), 'confirmPreflightForJobStart carries T1-191 marker');
    assert(
      /validatedTicket\?\.burnEnvelopeDivergence/.test(src),
      'reads ticket.burnEnvelopeDivergence',
    );
    assert(/divergenceMessage|divergenceKindLabel/.test(src), 'helpers defined');
    assert(/Preview . output mismatch/.test(src), 'dialog title literal present');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
