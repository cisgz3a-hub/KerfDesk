/**
 * T1-145: regression test for the pure top-level helpers extracted
 * from MachineService:
 *
 *   - mutatesWorkCoordinateSystem(cmd): G10/G92 detection with negative
 *     lookahead so G100/G920 don't false-match
 *   - safetyResultForStateMachine(result): action/motion/laser translation
 *   - safetyStatesEqual(a, b): structural equality
 *   - createApprovalNonce(): nonce generation (uniqueness check)
 *   - emptyBurnState(): empty BurnState factory
 *
 * Run: npx tsx tests/machine-service-helpers.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SafetyActionResult } from '../src/app/SafetyActionResult';
import {
  controllerDisconnectStopsJob,
  createApprovalNonce,
  emptyBurnState,
  mutatesWorkCoordinateSystem,
  safetyResultForStateMachine,
  safetyStatesEqual,
} from '../src/app/machineServiceHelpers';
import type { LaserController } from '../src/controllers/ControllerInterface';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== T1-145 MachineService helpers ===\n');

// -------- mutatesWorkCoordinateSystem --------
{
  assert(mutatesWorkCoordinateSystem('G10 L20 P1 X0 Y0 Z0'),
    'G10 → mutates');
  assert(mutatesWorkCoordinateSystem('G92 X0 Y0 Z0'),
    'G92 → mutates');
  assert(mutatesWorkCoordinateSystem('g10 l20 p1'),
    'lowercase g10 → mutates (case-insensitive)');
  assert(mutatesWorkCoordinateSystem('g92'),
    'lowercase g92 → mutates');
  // Negative lookahead: G100/G920/G1010 should NOT match
  assert(!mutatesWorkCoordinateSystem('G100'),
    'G100 → does NOT mutate (negative lookahead)');
  assert(!mutatesWorkCoordinateSystem('G920'),
    'G920 → does NOT mutate');
  assert(!mutatesWorkCoordinateSystem('G101'),
    'G101 → does NOT mutate');
  // Common non-mutating codes
  assert(!mutatesWorkCoordinateSystem('G0 X10 Y20'),
    'G0 → no mutate');
  assert(!mutatesWorkCoordinateSystem('G1 X10 F1000'),
    'G1 → no mutate');
  assert(!mutatesWorkCoordinateSystem('M3 S1000'),
    'M3 → no mutate');
  assert(!mutatesWorkCoordinateSystem(''),
    'empty string → no mutate');
  // Anchored at start of string — interior G10/G92 ignored
  assert(!mutatesWorkCoordinateSystem('G0 G10'),
    'G10 mid-command → no mutate (anchor ^)');
}

// -------- safetyResultForStateMachine --------
{
  const base = {
    action: 'stop',
    accepted: true,
    motionState: 'idle',
    laserState: 'unknown',
    positionTrusted: true,
    requiresRehome: false,
    requiresReconnect: false,
    requiresInspection: false,
    message: 'test',
    timestamp: 0,
  } as unknown as SafetyActionResult;

  const r = safetyResultForStateMachine(base);
  assert(r.action === 'stop',
    'stop action passes through');
  assert(r.message === 'test', 'message passes through');

  // abortJob → stop
  const r2 = safetyResultForStateMachine({ ...base, action: 'abortJob' } as SafetyActionResult);
  assert(r2.action === 'stop',
    'abortJob → stop');

  // running → moving
  const r3 = safetyResultForStateMachine({ ...base, motionState: 'running' } as SafetyActionResult);
  assert(r3.motionState === 'moving',
    'running motionState → moving');

  // laserState: off → confirmed
  const r4 = safetyResultForStateMachine({ ...base, laserState: 'off' } as SafetyActionResult);
  assert(r4.laserState === 'confirmed', 'off → confirmed');

  // laserState: commandedOff → commanded
  const r5 = safetyResultForStateMachine({ ...base, laserState: 'commandedOff' } as SafetyActionResult);
  assert(r5.laserState === 'commanded', 'commandedOff → commanded');

  // laserState: anything else → unknown
  const r6 = safetyResultForStateMachine({ ...base, laserState: 'unknown' } as SafetyActionResult);
  assert(r6.laserState === 'unknown', 'unknown → unknown');
}

// -------- safetyStatesEqual --------
{
  const a = { kind: 'idle', since: 0 } as never;
  const b = { kind: 'idle', since: 0 } as never;
  const c = { kind: 'alarm', since: 100 } as never;
  assert(safetyStatesEqual(a, b), 'structurally equal → true');
  assert(safetyStatesEqual(a, a), 'same reference → true');
  assert(!safetyStatesEqual(a, c), 'different shape → false');
}

// -------- createApprovalNonce --------
{
  const n1 = createApprovalNonce();
  const n2 = createApprovalNonce();
  assert(typeof n1 === 'string', 'returns string');
  assert(n1.length > 0, 'non-empty');
  assert(n1 !== n2, 'two calls produce distinct nonces');
}

// -------- emptyBurnState --------
{
  const s = emptyBurnState();
  assert(s.activeIds instanceof Set, 'activeIds is a Set');
  assert(s.burnedIds instanceof Set, 'burnedIds is a Set');
  assert(s.activeIds.size === 0, 'activeIds empty');
  assert(s.burnedIds.size === 0, 'burnedIds empty');
  const s2 = emptyBurnState();
  assert(s.activeIds !== s2.activeIds, 'each call returns a fresh Set instance');
}

// -------- T1-155: controllerDisconnectStopsJob --------
{
  // Declared = true → returns true
  const grbl = { family: 'grbl', capabilities: { safety: { disconnectStopsJob: true } } } as unknown as LaserController;
  assert(controllerDisconnectStopsJob(grbl) === true,
    'declared true → true');

  // Declared = false → returns false (even for grbl family)
  const grblFalse = { family: 'grbl', capabilities: { safety: { disconnectStopsJob: false } } } as unknown as LaserController;
  assert(controllerDisconnectStopsJob(grblFalse) === false,
    'declared false → false (overrides family default)');

  // Declared = 'unknown' → returns 'unknown'
  const grblUnknown = { family: 'grbl', capabilities: { safety: { disconnectStopsJob: 'unknown' } } } as unknown as LaserController;
  assert(controllerDisconnectStopsJob(grblUnknown) === 'unknown',
    'declared unknown → unknown');

  // No declaration + grbl family → true (default)
  const grblBare = { family: 'grbl' } as unknown as LaserController;
  assert(controllerDisconnectStopsJob(grblBare) === true,
    'grbl family + no declaration → true (family default)');

  // No declaration + gcode-line-stream family → true
  const gls = { family: 'gcode-line-stream' } as unknown as LaserController;
  assert(controllerDisconnectStopsJob(gls) === true,
    'gcode-line-stream family + no declaration → true');

  // No declaration + unknown family → 'unknown'
  const marlin = { family: 'marlin' } as unknown as LaserController;
  assert(controllerDisconnectStopsJob(marlin) === 'unknown',
    'marlin family + no declaration → unknown');
}

// -------- Source-level pin: MachineService delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const svcSrc = readFileSync(
    resolve(here, '../src/app/MachineService.ts'),
    'utf-8',
  );
  assert(/from '\.\/machineServiceHelpers'/.test(svcSrc),
    'MachineService imports from machineServiceHelpers');
  assert(/T1-145/.test(svcSrc),
    'MachineService carries T1-145 marker');
  // Inline definitions are gone
  assert(!/^function mutatesWorkCoordinateSystem/m.test(svcSrc),
    'inline mutatesWorkCoordinateSystem is gone from MachineService');
  assert(!/^function safetyResultForStateMachine/m.test(svcSrc),
    'inline safetyResultForStateMachine is gone');
  assert(!/^function safetyStatesEqual/m.test(svcSrc),
    'inline safetyStatesEqual is gone');
  assert(!/^function createApprovalNonce/m.test(svcSrc),
    'inline createApprovalNonce is gone');
  assert(!/^function emptyBurnState/m.test(svcSrc),
    'inline emptyBurnState is gone');
  // T1-155
  assert(!/^function controllerDisconnectStopsJob/m.test(svcSrc),
    'inline controllerDisconnectStopsJob is gone (T1-155)');

  const helperSrc = readFileSync(
    resolve(here, '../src/app/machineServiceHelpers.ts'),
    'utf-8',
  );
  assert(/T1-145/.test(helperSrc),
    'machineServiceHelpers carries T1-145 marker');
  for (const name of [
    'mutatesWorkCoordinateSystem',
    'safetyResultForStateMachine',
    'safetyStatesEqual',
    'createApprovalNonce',
    'emptyBurnState',
    'controllerDisconnectStopsJob',
  ]) {
    const re = new RegExp(`export function ${name}`);
    assert(re.test(helperSrc),
      `${name} is exported`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
