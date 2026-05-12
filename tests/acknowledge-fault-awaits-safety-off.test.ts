/**
 * T1-217 (v30 audit #2): `GrblController.acknowledgeFault()` must
 * AWAIT the defense-in-depth safety-off and only transition out of
 * the `faulted_requires_inspection` state when the laser-off contract
 * actually succeeded.
 *
 * Pre-T1-217 the body was:
 *
 *   void this.safetyOff().then(...).catch(...);
 *   this._state.errorCode = null;
 *   this._updateStatus('idle');
 *   return { ok: true };
 *
 * The safetyOff promise was fire-and-forget. The next two lines
 * cleared errorCode and flipped status to `'idle'` synchronously. If
 * BOTH the fault-time safetyOff AND this defense-in-depth safetyOff
 * failed, the UI saw `idle` with no enforcement that the laser was
 * actually off.
 *
 * Post-T1-217:
 *   - safetyOff → 'm5'         : fault cleared, status idle, ok:true
 *   - safetyOff → 'soft-reset' : fault cleared, status idle, ok:true
 *     (force-reset succeeded; laser is definitely off; logged)
 *   - safetyOff → 'failed'     : fault NOT cleared, status STAYS
 *     `faulted_requires_inspection`, ok:false with descriptive
 *     reason
 *
 * Run: npx tsx tests/acknowledge-fault-awaits-safety-off.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';

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

// Silence the audit-grade warns from the controller during the
// negative-path tests; they're tested separately via the structured
// return value.
const origWarn = console.warn;
console.warn = () => {};

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

function buildPort(): MockSerialPort {
  return new MockSerialPort((line: string) => {
    if (line.startsWith(';')) return [];
    return ['ok'];
  });
}

// Drive the controller into the faulted state directly via the
// private state mutator — same trick the legacy tests use to set up
// the fault. We can't easily synthesize a real fault from outside
// because the production path is multi-step (alarm → safetyOff →
// fault transition).
function forceFaultedState(ctrl: GrblController): void {
  const priv = ctrl as unknown as {
    _state: { status: string; errorCode: number | null };
    _updateStatus: (s: string) => void;
  };
  priv._state.errorCode = 9;
  priv._updateStatus('faulted_requires_inspection');
}

console.log('\n=== T1-217 acknowledgeFault awaits safety-off ===\n');

void (async () => {

// -------- 1. Happy path: M5 succeeds → fault cleared, idle --------
{
  const ctrl = new GrblController();
  const port = buildPort();
  port.open();
  await ctrl.connect(port);
  await flush();
  forceFaultedState(ctrl);
  assert(ctrl.state.status === 'faulted_requires_inspection',
    'precondition: controller is faulted');

  const result = await ctrl.acknowledgeFault();
  assert(result.ok === true, 'M5 success → result.ok === true');
  assert(ctrl.state.status === 'idle', 'M5 success → status flipped to idle');
  assert(ctrl.state.errorCode === null, 'M5 success → errorCode cleared');
  await ctrl.disconnect();
}

// -------- 2. M5 fails, soft-reset succeeds: fault cleared (force halt) --------
{
  const ctrl = new GrblController();
  const port = buildPort();
  port.open();
  await ctrl.connect(port);
  await flush();
  forceFaultedState(ctrl);

  // Fail ONLY the next critical write (the M5). The soft-reset is a
  // critical-byte-write, which uses a different fail flag; leave it
  // unblocked so the fallback succeeds.
  port.failNextCriticalWrite = true;

  const result = await ctrl.acknowledgeFault();
  assert(result.ok === true,
    'M5 fail + soft-reset success → result.ok === true (laser is off via forced reset)');
  assert(ctrl.state.status === 'idle', 'soft-reset success → status flipped to idle');
  await ctrl.disconnect();
}

// -------- 3. BOTH FAIL: stay in fault state, surface reason --------
{
  const ctrl = new GrblController();
  const port = buildPort();
  port.open();
  await ctrl.connect(port);
  await flush();
  forceFaultedState(ctrl);

  // Make ALL critical writes (both M5 and the soft-reset byte) fail.
  port.failAllCriticalWrites = true;

  const result = await ctrl.acknowledgeFault();
  assert(result.ok === false,
    'both fail → result.ok === false (fault NOT cleared)');
  assert(
    ctrl.state.status === 'faulted_requires_inspection',
    'both fail → status STAYS faulted_requires_inspection',
  );
  assert(
    ctrl.state.errorCode === 9,
    'both fail → errorCode NOT cleared (still shows the underlying error)',
  );
  assert(
    /laser-off failed|physical E-stop|power disconnect/i.test(result.reason ?? ''),
    `both fail → reason names the safety risk ("${result.reason}")`,
  );
  await ctrl.disconnect();
}

// -------- 4. Idempotency: ack when not faulted → ok:true, no safety-off --------
{
  const ctrl = new GrblController();
  const port = buildPort();
  port.open();
  await ctrl.connect(port);
  await flush();
  // No fault forced.
  // Even if the port would fail critical writes, ack should NOT call safetyOff.
  port.failAllCriticalWrites = true;

  const result = await ctrl.acknowledgeFault();
  assert(result.ok === true, 'idle controller: ack is a no-op returning ok:true');
  await ctrl.disconnect();
}

// -------- 5. Disconnected: returns ok:false with "Not connected" --------
{
  const ctrl = new GrblController();
  const result = await ctrl.acknowledgeFault();
  assert(result.ok === false, 'disconnected: ok:false');
  assert(result.reason === 'Not connected', 'disconnected: reason is "Not connected"');
}

// -------- 6. Source pins --------
{
  const src = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );
  assert(/T1-217/.test(src), 'GrblController.ts carries T1-217 marker');

  // Slice from the method signature to its closing brace. The
  // function is short (~60 lines after T1-217); a 2200-char window
  // covers the body but excludes the docstring of the next method
  // and other unrelated fire-and-forget call sites later in the file
  // (the error-handler safetyOff is a different path the audit
  // explicitly acknowledged is intentionally fire-and-forget).
  const ackStart = src.indexOf('async acknowledgeFault(');
  // Find the next top-level method or the closing brace at column 2.
  const ackEnd = src.indexOf('\n  // ─── ', ackStart);
  const ackBlock = src.slice(ackStart, ackEnd > ackStart ? ackEnd : ackStart + 2200);
  assert(
    /const result = await this\.safetyOff\(\);/.test(ackBlock),
    'acknowledgeFault awaits safetyOff() (no longer fire-and-forget)',
  );
  // The pre-T1-217 fire-and-forget pattern must be gone from
  // acknowledgeFault. (It legitimately remains in the GRBL error
  // handler — that's a different path the audit accepted as
  // intentional.)
  assert(
    !/^\s*void this\.safetyOff\(\)\.then/m.test(ackBlock),
    'acknowledgeFault body no longer uses `void this.safetyOff().then(...)` fire-and-forget',
  );
  // Failed-stage branch must NOT flip status to idle.
  assert(
    /result\.stage === 'failed'[\s\S]{0,500}return \{\s*ok: false/.test(ackBlock),
    "on safetyOff 'failed' the function returns { ok: false } early",
  );
  // The state flip (_updateStatus('idle') + errorCode = null) must
  // be AFTER the failed-branch return.
  const failedReturnIdx = ackBlock.indexOf("return {\n        ok: false,");
  const updateStatusIdx = ackBlock.indexOf("this._updateStatus('idle')");
  assert(
    failedReturnIdx > 0 && updateStatusIdx > 0 && failedReturnIdx < updateStatusIdx,
    "_updateStatus('idle') happens AFTER the failed-stage early return",
  );
}

console.warn = origWarn;
console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.warn = origWarn;
  console.error(err);
  process.exit(1);
});
