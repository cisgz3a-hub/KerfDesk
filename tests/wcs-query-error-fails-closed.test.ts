/**
 * T1-174 (audit Critical #5): a WCS query that returns an `error:`
 * response from GRBL must mark placement UNCERTAIN, not safe.
 *
 * Pre-T1-174 evidence (`src/controllers/grbl/GrblController.ts:1645-1659`):
 *
 *   if (this._awaitingWcsQueryOk) {
 *     if (line === 'ok') { ... }
 *     if (line.startsWith('error:')) {
 *       this._awaitingWcsQueryOk = false;
 *       this._currentG54 = null;
 *       this.skipWcsNormalization();   // <-- fail-OPEN bug
 *       return;
 *     }
 *     ...
 *   }
 *
 * And `skipWcsNormalization()` sets `_placementUncertain = false`.
 *
 * Failure scenario: the controller fails the `$#` query (firmware
 * variant, dropped packet, race with reset). The application then
 * treats placement as TRUSTED and a saved-origin job can start from
 * an unknown WCS offset. The head can engrave in the wrong physical
 * location.
 *
 * The audit (response received 2026-05-11) flagged this as Critical
 * #5 — a placement-trust failure on the hot path between connect
 * handshake and first job start.
 *
 * Post-T1-174:
 *  1. The `error:` branch marks `_settingsQueried = true` (so the
 *     controller doesn't loop trying to re-query) AND
 *     `_placementUncertain = true` with reason `'wcs_query_error'`.
 *  2. `skipWcsNormalization()` is NOT called from the error branch.
 *  3. `getPlacementUncertain()` returns `true` so the start-job gate
 *     refuses until the user disconnects, addresses the underlying
 *     state, and reconnects.
 *
 * Run: npx tsx tests/wcs-query-error-fails-closed.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GrblController } from '../src/controllers/grbl/GrblController';
import type { WcsUncertainReason } from '../src/controllers/grbl/GrblWcsConsentClassifier';

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

console.log('\n=== T1-174 WCS query error fails closed (audit Critical #5) ===\n');

// -------- 1. WCS query error → placement uncertain with reason --------
{
  const ctrl = new GrblController();
  // Reach into the private to put the controller into "awaiting WCS
  // query ok" state, the same state a real connect handshake would.
  const priv = ctrl as unknown as {
    _awaitingWcsQueryOk: boolean;
    _placementUncertain: boolean;
    _settingsQueried: boolean;
    _lastPlacementUncertainReason: WcsUncertainReason | null;
    _currentG54: { x: number; y: number; z: number } | null;
    _handleLine: (line: string) => void;
  };
  priv._awaitingWcsQueryOk = true;
  priv._placementUncertain = false;
  priv._settingsQueried = false;
  priv._lastPlacementUncertainReason = null;
  priv._currentG54 = { x: 0, y: 0, z: 0 };

  // Suppress the intentional console.warn so the test output is clean.
  const origWarn = console.warn;
  let warnCalled = false;
  let warnText = '';
  console.warn = (...args: unknown[]) => {
    warnCalled = true;
    warnText = args.map(String).join(' ');
  };
  try {
    priv._handleLine('error:9');
  } finally {
    console.warn = origWarn;
  }

  // TS narrows `priv._awaitingWcsQueryOk` etc. to the literal `true`
  // after the assignments above, so direct `=== false` comparisons
  // trip the "unintentional" check. `_handleLine` mutates the fields;
  // re-widen the reads via `Boolean(...)` so the assertions compile
  // AND run against the post-mutation values.
  assert(Boolean(priv._awaitingWcsQueryOk) === false, 'error: clears the _awaitingWcsQueryOk flag');
  assert(priv._currentG54 === null, 'error: clears the _currentG54 snapshot');
  assert(
    Boolean(priv._settingsQueried) === true,
    'error: marks _settingsQueried = true (no re-query loop)',
  );
  assert(
    Boolean(priv._placementUncertain) === true,
    'CRITICAL #5 invariant: error path marks _placementUncertain = true (NOT false)',
  );
  assert(
    priv._lastPlacementUncertainReason === 'wcs_query_error',
    `_lastPlacementUncertainReason === 'wcs_query_error' (got ${priv._lastPlacementUncertainReason})`,
  );
  assert(warnCalled, 'error: emits an audit-grade console.warn');
  assert(
    /T1-174|error:9|placement/i.test(warnText),
    'warn message mentions the T1-174 marker / error line / placement',
  );
}

// -------- 2. getPlacementUncertain() returns true so start-gate blocks --------
{
  const ctrl = new GrblController();
  const priv = ctrl as unknown as {
    _awaitingWcsQueryOk: boolean;
    _handleLine: (line: string) => void;
  };
  priv._awaitingWcsQueryOk = true;
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    priv._handleLine('error:9');
  } finally {
    console.warn = origWarn;
  }
  assert(
    ctrl.getPlacementUncertain() === true,
    'getPlacementUncertain() returns true after WCS query error → start gate blocks',
  );
  assert(
    ctrl.getPlacementUncertainReason?.() === 'wcs_query_error',
    'getPlacementUncertainReason() returns "wcs_query_error" for diagnostics',
  );
}

// -------- 3. Successful WCS query path is unaffected (regression bait) --------
{
  // Drive the controller through a normal successful query path. The
  // `ok` branch must still call `_onWcsQueryOk` and the placement
  // state must remain non-uncertain (the classifier decides verdict
  // separately).
  const ctrl = new GrblController();
  const priv = ctrl as unknown as {
    _awaitingWcsQueryOk: boolean;
    _placementUncertain: boolean;
    _handleLine: (line: string) => void;
    _onWcsQueryOk: () => void;
  };
  let onWcsQueryOkFired = false;
  // Replace the private with a probe so we can confirm the ok branch fires it.
  const origOnWcsQueryOk = priv._onWcsQueryOk.bind(ctrl);
  (priv as unknown as { _onWcsQueryOk: () => void })._onWcsQueryOk = () => {
    onWcsQueryOkFired = true;
    // Defer the real classifier — we don't want it to mutate state
    // for the regression bait. We're just confirming the routing.
  };
  priv._awaitingWcsQueryOk = true;
  priv._handleLine('ok');
  assert(
    onWcsQueryOkFired,
    'happy path: `ok` line still triggers _onWcsQueryOk (no regression to the success path)',
  );
  // Restore for cleanliness (no longer used).
  (priv as unknown as { _onWcsQueryOk: () => void })._onWcsQueryOk = origOnWcsQueryOk;
}

// -------- 4. Source pins on the fix --------
{
  const src = readFileSync(resolve(here, '../src/controllers/grbl/GrblController.ts'), 'utf-8');
  const classifierSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblWcsConsentClassifier.ts'),
    'utf-8',
  );

  assert(/T1-174/.test(src), 'GrblController carries T1-174 marker');
  assert(/audit Critical #5|Critical #5/.test(src), 'GrblController cross-references audit Critical #5');

  // The pre-T1-174 line MUST be gone: `this.skipWcsNormalization()` inside the
  // `_awaitingWcsQueryOk` + `error:` branch.
  // Match the pattern that was in the bug:
  const bugPattern = /_awaitingWcsQueryOk\b[\s\S]{0,400}line\.startsWith\(['"]error:['"]\)[\s\S]{0,200}this\.skipWcsNormalization\(\)/;
  assert(
    !bugPattern.test(src),
    'pre-T1-174 fail-OPEN call (`this.skipWcsNormalization()` inside the WCS-error branch) is gone',
  );

  // The new fail-CLOSED line must be present.
  assert(
    /_placementUncertain\s*=\s*true;\s*\n\s*this\._lastPlacementUncertainReason\s*=\s*['"]wcs_query_error['"]/.test(src),
    'GrblController sets _placementUncertain = true with reason "wcs_query_error" on WCS error',
  );

  // The new reason is added to the union.
  assert(
    /['"]wcs_query_error['"]/.test(classifierSrc),
    'WcsUncertainReason union includes "wcs_query_error"',
  );
  assert(
    /T1-174/.test(classifierSrc),
    'GrblWcsConsentClassifier carries T1-174 marker for the new reason',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
