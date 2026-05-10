/**
 * T1-128: regression test for the pure GRBL safe-state-at-connect
 * classifier extracted from `_classifySafeStateReason`. Fourth slice
 * of the audit's Sprint 4 controller-cleanup sequence.
 *
 * Pre-T1-128 the classifier read `this._state` directly so testing
 * required mounting the whole controller. Pure extraction takes
 * the relevant `MachineState` fields as input and returns the same
 * `UnsafeAtConnectReason | null` verdict.
 *
 * This test pins:
 *   1. Each non-safe status maps to its named reason ('alarm', 'run',
 *      'hold', 'door' (T1-115), 'check').
 *   2. `'idle' + FS:0,0` → null (handshake passes).
 *   3. `'idle' + non-zero spindle` → 'unsafe-residual-spindle'.
 *   4. `'idle' + non-zero feed` → 'unsafe-residual-spindle'.
 *   5. `'homing'`, `'connecting'`, `'disconnected'`, `'faulted_requires_inspection'`
 *      all yield null (no verdict — distinct gates).
 *   6. Source-pin: GrblController._classifySafeStateReason now
 *      delegates; the inline switch is gone.
 *
 * Run: npx tsx tests/grbl-safe-state-classifier.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MachineState } from '../src/controllers/ControllerInterface';
import { classifyGrblSafeState } from '../src/controllers/grbl/GrblSafeStateClassifier';

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

function inputAt(
  status: MachineState['status'],
  spindleSpeed = 0,
  feedRate = 0,
): { status: MachineState['status']; spindleSpeed: number; feedRate: number } {
  return { status, spindleSpeed, feedRate };
}

console.log('\n=== T1-128 GRBL safe-state-at-connect classifier ===\n');

// -------- 1. Direct status mappings --------
{
  assert(classifyGrblSafeState(inputAt('alarm')) === 'alarm',
    `'alarm' → 'alarm'`);
  assert(classifyGrblSafeState(inputAt('run')) === 'run',
    `'run' → 'run'`);
  assert(classifyGrblSafeState(inputAt('hold')) === 'hold',
    `'hold' → 'hold'`);
  assert(classifyGrblSafeState(inputAt('door')) === 'door',
    `'door' → 'door' (T1-115 first-class status)`);
  assert(classifyGrblSafeState(inputAt('check')) === 'check',
    `'check' → 'check'`);
}

// -------- 2. Idle + FS 0,0 → handshake passes (null verdict) --------
{
  assert(classifyGrblSafeState(inputAt('idle', 0, 0)) === null,
    `'idle' + spindle=0 + feed=0 → null (clean handshake)`);
}

// -------- 3. Idle but FS reports residual laser/feed --------
{
  assert(classifyGrblSafeState(inputAt('idle', 500, 0)) === 'unsafe-residual-spindle',
    `'idle' + spindle=500 → 'unsafe-residual-spindle'`);
  assert(classifyGrblSafeState(inputAt('idle', 0, 1500)) === 'unsafe-residual-spindle',
    `'idle' + feed=1500 → 'unsafe-residual-spindle'`);
  assert(classifyGrblSafeState(inputAt('idle', 500, 1500)) === 'unsafe-residual-spindle',
    `'idle' + both non-zero → 'unsafe-residual-spindle'`);
}

// -------- 4. Statuses with no verdict (handed to other gates) --------
{
  assert(classifyGrblSafeState(inputAt('homing')) === null,
    `'homing' → null (user-initiated startup; not a connect-time safety check)`);
  assert(classifyGrblSafeState(inputAt('connecting')) === null,
    `'connecting' → null (transient; not operational)`);
  assert(classifyGrblSafeState(inputAt('disconnected')) === null,
    `'disconnected' → null (no live state to classify)`);
  assert(classifyGrblSafeState(inputAt('faulted_requires_inspection')) === null,
    `'faulted_requires_inspection' → null (T2-12 owns its own gate)`);
}

// -------- 5. Pure: same input → same output (no hidden state) --------
{
  const input = inputAt('idle', 100, 0);
  const r1 = classifyGrblSafeState(input);
  const r2 = classifyGrblSafeState(input);
  assert(r1 === r2 && r1 === 'unsafe-residual-spindle',
    'classifier is pure (idempotent)');
}

// -------- 6. Source-level pins --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const ctlSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );
  assert(/import \{ classifyGrblSafeState \} from '\.\/GrblSafeStateClassifier'/.test(ctlSrc),
    'GrblController imports classifyGrblSafeState');
  assert(/T1-128/.test(ctlSrc),
    'GrblController carries T1-128 marker');
  assert(/return classifyGrblSafeState\(\{/.test(ctlSrc),
    '_classifySafeStateReason delegates to classifyGrblSafeState');
  // The pre-T1-128 inline if-chain (`if (status === 'alarm') return 'alarm';`)
  // is gone from the controller — pin its absence.
  assert(
    !/if \(status === 'alarm'\) return 'alarm';\s*if \(status === 'run'\) return 'run';\s*if \(status === 'hold'\)/.test(ctlSrc),
    'inline `if (status === alarm) return alarm; if (status === run) ...` chain is gone',
  );

  const classifierSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblSafeStateClassifier.ts'),
    'utf-8',
  );
  assert(/T1-128/.test(classifierSrc),
    'GrblSafeStateClassifier carries T1-128 marker');
  assert(/export function classifyGrblSafeState/.test(classifierSrc),
    'classifyGrblSafeState is exported');
  assert(/export interface SafeStateClassifierInput/.test(classifierSrc),
    'SafeStateClassifierInput interface is exported');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
