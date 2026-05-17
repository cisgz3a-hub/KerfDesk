/**
 * T1-191 / S25-06-001: burn-envelope divergence must be surfaced
 * before the standard blocker / warning flow, and every current
 * non-null divergence kind must hard-block machine start.
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

console.log('\n=== T1-191/S25-06-001 burn-envelope divergence blocks start ===\n');

void (async () => {
  // -------- 1. envelope-edge-mismatch: hard-blocked --------
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
    let alertCount = 0;
    let confirmCount = 0;
    const showAlert = async (title: string, msg: string): Promise<void> => {
      alertCount++;
      capturedTitle = title;
      capturedMsg = msg;
    };
    const showConfirm = async (title: string, msg: string): Promise<boolean> => {
      confirmCount++;
      capturedTitle = title;
      capturedMsg = msg;
      return true;
    };
    const result = await confirmPreflightForJobStart(
      emptySummary, showAlert, showConfirm, makeTicket(divergence),
    );
    assert(alertCount === 1, 'edge-mismatch: exactly 1 blocking alert');
    assert(confirmCount === 0, 'edge-mismatch: no override confirm is offered');
    assert(/Cannot start job/i.test(capturedTitle), 'title hard-blocks job start');
    assert(/Max edge delta: 3\.000 mm/.test(capturedMsg), 'message includes maxEdgeDeltaMm');
    assert(/tolerance: 0\.5 mm/i.test(capturedMsg), 'message includes the tolerance');
    assert(/Plan burn moves: 1/.test(capturedMsg), 'message includes plan move count');
    assert(/Emitted burn moves: 1/.test(capturedMsg), 'message includes emitted move count');
    assert(/differs from the plan/i.test(capturedMsg), 'message describes the kind');
    assert(!/Proceed anyway/i.test(capturedMsg), 'message does not offer proceed-anyway override');
    assert(result.confirmed === false, 'divergence hard-block -> confirmed=false');
    assert(result.ticket === null, 'divergence hard-block -> ticket=null');
  }

  // -------- 2. emitted-empty-plan-non-empty: hard-blocked --------
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
    let alertCount = 0;
    let confirmCount = 0;
    const showAlert = async (): Promise<void> => { alertCount++; };
    const showConfirm = async (): Promise<boolean> => { confirmCount++; return true; };
    const result = await confirmPreflightForJobStart(
      emptySummary, showAlert, showConfirm, makeTicket(divergence),
    );
    assert(alertCount === 1, 'emitted-empty-plan-non-empty: blocking alert shown');
    assert(confirmCount === 0, 'emitted-empty-plan-non-empty: no override confirm is offered');
    assert(result.confirmed === false, 'emitted-empty-plan-non-empty hard-blocks start');
    assert(result.ticket === null, 'emitted-empty-plan-non-empty returns no ticket');
  }

  // -------- 3. plan-empty-emitted-non-empty: kind label appears and blocks --------
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
    let confirmCount = 0;
    const showAlert = async (_t: string, msg: string): Promise<void> => { capturedMsg = msg; };
    const showConfirm = async (): Promise<boolean> => { confirmCount++; return true; };
    const result = await confirmPreflightForJobStart(
      emptySummary, showAlert, showConfirm, makeTicket(divergence),
    );
    assert(
      /burn moves the plan does not/i.test(capturedMsg),
      'plan-empty-emitted-non-empty: kind label present',
    );
    assert(!/Proceed anyway/i.test(capturedMsg), 'plan-empty-emitted-non-empty: no proceed-anyway language');
    assert(confirmCount === 0, 'plan-empty-emitted-non-empty: no override confirm is offered');
    assert(result.confirmed === false, 'plan-empty-emitted-non-empty hard-blocks start');
  }

  // -------- 4. No divergence: no dedicated alert/confirm shown --------
  {
    let alertCount = 0;
    let confirmCount = 0;
    const showAlert = async (): Promise<void> => { alertCount++; };
    const showConfirm = async (): Promise<boolean> => { confirmCount++; return true; };
    const result = await confirmPreflightForJobStart(
      emptySummary, showAlert, showConfirm, makeTicket(null),
    );
    assert(alertCount === 0, 'no divergence: no divergence alert fires');
    assert(confirmCount === 0, 'no divergence: no divergence confirm fires');
    assert(result.confirmed === true, 'no divergence + no warnings: confirmed without interruption');
  }

  // -------- 5. Source pins --------
  {
    const src = readFileSync(resolve(here, '../src/core/preflight/confirmPreflightForJobStart.ts'), 'utf-8');
    assert(/T1-191/.test(src), 'confirmPreflightForJobStart carries T1-191 marker');
    assert(/S25-06-001/.test(src), 'confirmPreflightForJobStart carries S25-06-001 marker');
    assert(
      /validatedTicket\?\.burnEnvelopeDivergence/.test(src),
      'reads ticket.burnEnvelopeDivergence',
    );
    assert(/divergenceMessage|divergenceKindLabel/.test(src), 'helpers defined');
    assert(/Cannot start job/.test(src), 'hard-block title literal present');
    assert(!/Proceed anyway\?/.test(src), 'divergence path no longer offers proceed-anyway override');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
