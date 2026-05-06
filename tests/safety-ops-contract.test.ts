/**
 * T2-42: ControllerSafetyOps as a separate contract. Pre-T2-42 the
 * safety methods lived directly on LaserController, mixed with
 * transport / lifecycle / streaming.
 *
 * Run: npx tsx tests/safety-ops-contract.test.ts
 */
import {
  SAFETY_OP_METHODS,
  actionForMethod,
  makeCapabilityNotSupportedResult,
  makeUnsupportedSafetyOps,
  isSafetyOpDeclared,
  type ControllerSafetyOps,
  type SafetyOpMethod,
  type SafetyUrgency,
  type TestFireRequest,
} from '../src/controllers/ControllerSafetyOps';
import type { SafetyActionResult } from '../src/app/SafetyActionResult';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-42 ControllerSafetyOps contract ===\n');

void (async () => {

// 1. SAFETY_OP_METHODS lists 8 methods
{
  assert(SAFETY_OP_METHODS.length === 8, `8 methods declared`);
  for (const m of [
    'laserOff', 'pauseJob', 'resumeJob', 'abortJob',
    'emergencyStop', 'disconnectSafely',
    'beginTestFire', 'endTestFire',
  ]) {
    assert(SAFETY_OP_METHODS.includes(m as SafetyOpMethod),
      `includes '${m}'`);
  }
}

// 2. actionForMethod maps each method to a SafetyAction
{
  assert(actionForMethod('laserOff') === 'laserOff', `laserOff`);
  assert(actionForMethod('pauseJob') === 'pause', `pauseJob → pause`);
  assert(actionForMethod('resumeJob') === 'resume', `resumeJob → resume`);
  assert(actionForMethod('abortJob') === 'abortJob', `abortJob`);
  assert(actionForMethod('emergencyStop') === 'emergencyStop', `emergencyStop`);
  assert(actionForMethod('disconnectSafely') === 'disconnectSafe', `disconnectSafely → disconnectSafe`);
  assert(actionForMethod('beginTestFire') === 'beginTestFire', `beginTestFire`);
  assert(actionForMethod('endTestFire') === 'endTestFire', `endTestFire`);
}

// 3. makeCapabilityNotSupportedResult: shape + accepted=false
{
  const r = makeCapabilityNotSupportedResult('pauseJob', 'no-pause-on-this-fw', 1000);
  assert(r.action === 'pause', `action populated`);
  assert(r.accepted === false, `accepted=false`);
  assert(r.motionState === 'unknown', `motionState=unknown`);
  assert(r.laserState === 'unknown', `laserState=unknown`);
  assert(r.positionTrusted === 'unknown', `positionTrusted=unknown`);
  assert(r.requiresRehome === 'unknown', `requiresRehome=unknown`);
  assert(r.requiresReconnect === false, `requiresReconnect=false`);
  assert(r.requiresInspection === false, `requiresInspection=false`);
  assert(r.message === 'no-pause-on-this-fw', `detail in message`);
  assert(r.timestamp === 1000, `timestamp from arg`);
}

// 4. makeCapabilityNotSupportedResult: default timestamp
{
  const before = Date.now();
  const r = makeCapabilityNotSupportedResult('laserOff', 'detail');
  const after = Date.now();
  assert(r.timestamp >= before && r.timestamp <= after, `default timestamp = now`);
}

// 5. makeUnsupportedSafetyOps: returns a full ControllerSafetyOps
{
  const ops = makeUnsupportedSafetyOps('this controller does not support safety');
  for (const m of SAFETY_OP_METHODS) {
    const fn = (ops as unknown as Record<string, unknown>)[m];
    assert(typeof fn === 'function', `${m}: implemented`);
  }
}

// 6. makeUnsupportedSafetyOps: every method returns capability-not-supported
{
  const ops = makeUnsupportedSafetyOps('detail-X');
  const r1 = await ops.laserOff('test', 'normal');
  assert(r1.accepted === false && r1.message === 'detail-X', `laserOff → not supported`);
  const r2 = await ops.pauseJob();
  assert(r2.accepted === false && r2.action === 'pause', `pauseJob → not supported`);
  const r3 = await ops.beginTestFire({ powerS: 100, durationMs: 100 });
  assert(r3.accepted === false && r3.action === 'beginTestFire', `beginTestFire → not supported`);
}

// 7. makeUnsupportedSafetyOps: clock injection
{
  const ops = makeUnsupportedSafetyOps('reason', () => 42);
  const r = await ops.emergencyStop();
  assert(r.timestamp === 42, `clock injected for timestamp`);
}

// 8. isSafetyOpDeclared: full ops returns true for every method
{
  const ops = makeUnsupportedSafetyOps('-');
  for (const m of SAFETY_OP_METHODS) {
    assert(isSafetyOpDeclared(ops, m), `${m}: declared`);
  }
}

// 9. isSafetyOpDeclared: missing method returns false
{
  const partial = {
    laserOff: () => Promise.resolve(makeCapabilityNotSupportedResult('laserOff', '-')),
    // pauseJob deliberately missing
  } as unknown as ControllerSafetyOps;
  assert(isSafetyOpDeclared(partial, 'laserOff'), `present method → true`);
  assert(!isSafetyOpDeclared(partial, 'pauseJob'), `missing method → false`);
}

// 10. Audit's headline: future Marlin firmware refuses pause cleanly
{
  const marlinOps: ControllerSafetyOps = {
    ...makeUnsupportedSafetyOps('Marlin firmware: not implemented yet'),
    pauseJob: () => Promise.resolve({
      action: 'pause',
      accepted: false,
      motionState: 'unknown',
      laserState: 'unknown',
      positionTrusted: 'unknown',
      requiresRehome: 'unknown',
      requiresReconnect: false,
      requiresInspection: false,
      message: 'This Marlin firmware does not support recoverable pause. Use Stop instead.',
      timestamp: 5000,
    }),
  };
  const r = await marlinOps.pauseJob();
  assert(r.accepted === false, `Marlin pauseJob refuses`);
  assert(r.message?.includes('Marlin') === true, `message names firmware`);
  assert(r.message?.includes('Stop') === true, `message suggests Stop`);
}

// 11. ControllerSafetyOps shape: TestFireRequest carries powerS + durationMs
{
  const req: TestFireRequest = { powerS: 250, durationMs: 100 };
  const ops = makeUnsupportedSafetyOps('-');
  const r = await ops.beginTestFire(req);
  assert(r.action === 'beginTestFire', `action=beginTestFire`);
}

// 12. SafetyUrgency parameter shape: laserOff accepts urgency literal
{
  const ops = makeUnsupportedSafetyOps('-');
  const urgencies: SafetyUrgency[] = ['normal', 'urgent', 'emergency'];
  for (const u of urgencies) {
    const r = await ops.laserOff('test reason', u);
    assert(r.action === 'laserOff', `urgency '${u}' accepted`);
  }
}

// 13. SafetyActionResult round-trip: capability-not-supported is the right shape
{
  const r: SafetyActionResult = makeCapabilityNotSupportedResult('emergencyStop', 'no-estop', 100);
  // Asserting this assigns to SafetyActionResult means the type-check passes.
  assert(r.timestamp === 100, `assignable to SafetyActionResult`);
}

// 14. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/controllers/ControllerSafetyOps.ts'), 'utf-8');
  assert(/T2-42/.test(src), 'T2-42 marker');
  for (const id of [
    'SafetyUrgency', 'TestFireRequest', 'ControllerSafetyOps',
    'SAFETY_OP_METHODS', 'SafetyOpMethod', 'actionForMethod',
    'makeCapabilityNotSupportedResult', 'makeUnsupportedSafetyOps',
    'isSafetyOpDeclared',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const m of [
    'laserOff', 'pauseJob', 'resumeJob', 'abortJob',
    'emergencyStop', 'disconnectSafely',
    'beginTestFire', 'endTestFire',
  ]) {
    assert(src.includes(m), `method '${m}' declared`);
  }
  for (const u of ['normal', 'urgent', 'emergency']) {
    assert(src.includes(`'${u}'`), `urgency '${u}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
