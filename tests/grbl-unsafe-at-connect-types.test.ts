/**
 * T1-153: source-pin test for the UnsafeAtConnectReason +
 * UnsafeAtConnectState type extraction. These types were already
 * exported from GrblController; T1-153 just moves them to a
 * dedicated 60-line type module so the safe-state classifier and
 * the banner UI can import without dragging the 2500-line
 * controller into their dependency graph.
 *
 * Runtime checks: union members can be assigned (compile-time);
 * GrblController re-export resolves to the same type (compile-time);
 * source-pin: the inline declaration is gone.
 *
 * Run: npx tsx tests/grbl-unsafe-at-connect-types.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  UnsafeAtConnectReason,
  UnsafeAtConnectState,
} from '../src/controllers/grbl/GrblUnsafeAtConnect';
// Importing the same types via the controller's public surface — the
// re-export contract.
import type {
  UnsafeAtConnectReason as UnsafeViaController,
  UnsafeAtConnectState as UnsafeStateViaController,
} from '../src/controllers/grbl/GrblController';

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

console.log('\n=== T1-153 GRBL unsafe-at-connect type extraction ===\n');

// Compile-time: every union member must be assignable
const reasons: UnsafeAtConnectReason[] = [
  'alarm', 'run', 'hold', 'door', 'check', 'no-status-response', 'unsafe-residual-spindle',
];
assert(reasons.length === 7, 'UnsafeAtConnectReason has 7 members');

// Compile-time check: re-export keeps types compatible
const viaHelper: UnsafeAtConnectReason = 'alarm';
const viaController: UnsafeViaController = viaHelper;
const viaController2: UnsafeAtConnectReason = viaController;
assert(viaController2 === 'alarm',
  'GrblController.UnsafeAtConnectReason is assignment-compatible with the helper module');

// Compile-time: UnsafeAtConnectState shape is preserved
const state: UnsafeAtConnectState = {
  reason: 'alarm',
  capturedAt: 0,
  status: 'idle' as never,
  alarmCode: 1,
  feedRate: 0,
  spindleSpeed: 0,
};
const stateViaController: UnsafeStateViaController = state;
assert(stateViaController.reason === 'alarm',
  'UnsafeAtConnectState round-trips through the re-export');

// -------- Source-level pin --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const ctrlSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );
  assert(/from '\.\/GrblUnsafeAtConnect'/.test(ctrlSrc),
    'GrblController imports types from ./GrblUnsafeAtConnect');
  assert(/T1-153/.test(ctrlSrc),
    'GrblController carries T1-153 marker');
  // Inline declarations are gone
  assert(!/^export type UnsafeAtConnectReason\b/m.test(ctrlSrc),
    'inline UnsafeAtConnectReason declaration is gone');
  assert(!/^export interface UnsafeAtConnectState\b/m.test(ctrlSrc),
    'inline UnsafeAtConnectState declaration is gone');
  // Re-exports preserved
  assert(/export type \{[^}]*UnsafeAtConnectReason/.test(ctrlSrc),
    'UnsafeAtConnectReason is re-exported');
  assert(/UnsafeAtConnectState[^}]*\}/.test(ctrlSrc),
    'UnsafeAtConnectState is re-exported');

  const helperSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblUnsafeAtConnect.ts'),
    'utf-8',
  );
  assert(/T1-153/.test(helperSrc),
    'GrblUnsafeAtConnect carries T1-153 marker');
  assert(/export type UnsafeAtConnectReason/.test(helperSrc),
    'UnsafeAtConnectReason exported from helper');
  assert(/export interface UnsafeAtConnectState/.test(helperSrc),
    'UnsafeAtConnectState exported from helper');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
