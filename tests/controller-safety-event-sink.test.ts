/**
 * T1-202 (extends T1-201): inject a `ControllerSafetyEventSink`
 * into `GrblController` so controller-layer safety events
 * (wcs-query-error, placement-uncertain) reach the
 * `MachineEventLedger` without creating an `app → controllers`
 * reverse dependency.
 *
 * Why the sink pattern instead of a direct ledger import in
 * GrblController: the layered architecture rule (see CLAUDE.md
 * "Module boundary rule") forbids `controllers/` importing from
 * `app/`. The handoff note at T1-195 / T1-201 flagged this
 * specifically as the reason WCS-query-error wasn't wired
 * inline with the other ledger sites. The sink is a callback
 * injected from `useControllerConnection.ts` (in `ui/`, which
 * IS allowed to import from `app/`), preserving the layering.
 *
 * Sites pinned:
 *   1. `_handleLine` WCS-query-error branch emits BOTH a
 *      `wcs-query-error` AND a `placement-uncertain` event
 *      sharing the same timestamp (single transition, two
 *      facets of observability).
 *   2. `_handleSettingsHandshakeComplete` (`verdict.kind ===
 *      'unknown'`) emits a `placement-uncertain` event with
 *      the verdict's reason.
 *   3. `_emitWcsPayload` no-consent-listener fallback emits a
 *      `placement-uncertain` event with reason
 *      `no_wcs_consent_listener`.
 *   4. `useControllerConnection` registers a sink that forwards
 *      to `getMachineEventLedger().append(...)`.
 *
 * Run: npx tsx tests/controller-safety-event-sink.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GrblController } from '../src/controllers/grbl/GrblController';
import type { ControllerSafetyEvent } from '../src/controllers/grbl/GrblController';

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

// Suppress audit-grade console.warn from the controller so the test
// output stays focused on the sink assertions.
const origWarn = console.warn;
console.warn = () => {};

console.log('\n=== T1-202 GrblController safety-event sink ===\n');

// -------- 1. setSafetyEventSink is idempotent / nullable --------
{
  const ctrl = new GrblController();
  // Calling without registering should not throw — the controller
  // tolerates a null sink and continues to console.warn.
  ctrl.setSafetyEventSink(null);
  assert(true, 'setSafetyEventSink(null) is allowed');
  // Setting a sink does not throw.
  ctrl.setSafetyEventSink(() => {});
  // Resetting to null is allowed.
  ctrl.setSafetyEventSink(null);
  assert(true, 'setSafetyEventSink can be cleared back to null');
}

// -------- 2. WCS-query-error branch emits paired events --------
{
  const ctrl = new GrblController();
  const events: ControllerSafetyEvent[] = [];
  ctrl.setSafetyEventSink((e) => { events.push(e); });

  // Use the private flag setter / line-handler via `as any` since
  // the production path goes through realtime status + $#-handshake.
  // Setting the awaiting flag and feeding an error: line through
  // _handleLine reproduces the T1-174 WCS-query-error branch.
  const priv = ctrl as unknown as {
    _awaitingWcsQueryOk: boolean;
    _handleLine: (line: string) => void;
  };
  priv._awaitingWcsQueryOk = true;
  priv._handleLine('error:33');

  assert(events.length === 2, `WCS error branch emits 2 events (got ${events.length})`);
  const wcsErr = events.find(e => e.kind === 'wcs-query-error');
  const placement = events.find(e => e.kind === 'placement-uncertain');
  assert(wcsErr !== undefined, 'wcs-query-error event emitted');
  assert(placement !== undefined, 'placement-uncertain event emitted');
  if (wcsErr && wcsErr.kind === 'wcs-query-error') {
    assert(wcsErr.grblErrorLine === 'error:33', `grblErrorLine === 'error:33' (got '${wcsErr.grblErrorLine}')`);
  }
  if (placement && placement.kind === 'placement-uncertain') {
    assert(placement.reason === 'wcs_query_error', `placement.reason === 'wcs_query_error' (got '${placement.reason}')`);
  }
  if (wcsErr && placement) {
    assert(wcsErr.t === placement.t, 'paired events share the same timestamp');
  }
}

// -------- 3. Sink absent on construction: emit path is a no-op --------
{
  const ctrl = new GrblController();
  // Do NOT setSafetyEventSink. The same emit path should run
  // without throwing — the sink is optional.
  const priv = ctrl as unknown as {
    _awaitingWcsQueryOk: boolean;
    _handleLine: (line: string) => void;
  };
  priv._awaitingWcsQueryOk = true;
  let threw = false;
  try {
    priv._handleLine('error:33');
  } catch (_e: unknown) {
    threw = true;
  }
  assert(!threw, 'WCS-error branch with no sink does not throw');
}

// -------- 4. Source pins on the controller --------
{
  const src = readFileSync(resolve(here, '../src/controllers/grbl/GrblController.ts'), 'utf-8');
  assert(/T1-202/.test(src), 'GrblController.ts carries T1-202 marker');
  assert(/export type ControllerSafetyEvent/.test(src), 'ControllerSafetyEvent type exported');
  assert(/export type ControllerSafetyEventSink/.test(src), 'ControllerSafetyEventSink type exported');
  assert(
    /setSafetyEventSink\(sink: ControllerSafetyEventSink \| null\):/.test(src),
    'setSafetyEventSink(sink|null) method declared',
  );
  // Three emit sites: WCS-query-error (twin payload), T1-117 unknown,
  // T1-20 no-listener fallback. Plus the existing wcs-query-error +
  // its paired placement-uncertain — count `_safetyEventSink?.(` calls.
  const sinkCallCount = (src.match(/this\._safetyEventSink\?\.\(/g) ?? []).length;
  assert(sinkCallCount === 4, `controller has 4 sink-call sites (got ${sinkCallCount})`);
  // The WCS-query-error branch must emit BOTH kinds — pin via the
  // shared `t` variable.
  const wcsBranchIdx = src.indexOf("T1-174: WCS query");
  const wcsBranchSlice = src.slice(wcsBranchIdx, wcsBranchIdx + 2500);
  assert(/const t = Date\.now\(\);/.test(wcsBranchSlice), 'WCS-error branch declares shared t');
  assert(/kind:\s*'wcs-query-error'/.test(wcsBranchSlice), 'WCS-error branch emits wcs-query-error');
  assert(/kind:\s*'placement-uncertain'/.test(wcsBranchSlice), 'WCS-error branch also emits placement-uncertain');
}

// -------- 5. Source pins on useControllerConnection --------
{
  const hookSrc = readFileSync(
    resolve(here, '../src/ui/hooks/useControllerConnection.ts'),
    'utf-8',
  );
  assert(/T1-202/.test(hookSrc), 'useControllerConnection.ts carries T1-202 marker');
  assert(
    /import \{ getMachineEventLedger \} from '\.\.\/\.\.\/app\/MachineEventLedger'/.test(hookSrc),
    'hook imports getMachineEventLedger from app layer (allowed: ui → app)',
  );
  assert(
    /import \{ GrblController \} from '\.\.\/\.\.\/controllers\/grbl\/GrblController'/.test(hookSrc),
    'hook imports GrblController for instanceof check',
  );
  assert(
    /controller instanceof GrblController/.test(hookSrc),
    'hook narrows to GrblController via instanceof',
  );
  assert(
    /controller\.setSafetyEventSink\(\(event\)\s*=>\s*\{\s*getMachineEventLedger\(\)\.append\(event\);\s*\}\)/.test(hookSrc),
    'hook wires setSafetyEventSink to ledger.append',
  );
}

// -------- 6. MachineEvent union still declares the kinds --------
{
  const ledgerSrc = readFileSync(resolve(here, '../src/app/MachineEventLedger.ts'), 'utf-8');
  assert(/kind:\s*'wcs-query-error'/.test(ledgerSrc), "MachineEvent declares 'wcs-query-error'");
  assert(/kind:\s*'placement-uncertain'/.test(ledgerSrc), "MachineEvent declares 'placement-uncertain'");
}

console.warn = origWarn;
console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
