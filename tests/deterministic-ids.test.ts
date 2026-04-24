/**
 * {@link generateId} deterministic mode (LASERFORGE_DETERMINISTIC_IDS + __LF_DETERMINISTIC_IDS__).
 * Run: npx tsx tests/deterministic-ids.test.ts
 */

import { generateId, resetDeterministicCounter } from '../src/core/types';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function clearDeterministicMode(): void {
  delete process.env.LASERFORGE_DETERMINISTIC_IDS;
  (globalThis as { __LF_DETERMINISTIC_IDS__?: boolean }).__LF_DETERMINISTIC_IDS__ = false;
}

function setOnlyEnvVar(): void {
  (globalThis as { __LF_DETERMINISTIC_IDS__?: boolean }).__LF_DETERMINISTIC_IDS__ = false;
  process.env.LASERFORGE_DETERMINISTIC_IDS = '1';
  resetDeterministicCounter();
}

function setOnlyGlobalFlag(): void {
  delete process.env.LASERFORGE_DETERMINISTIC_IDS;
  (globalThis as { __LF_DETERMINISTIC_IDS__?: boolean }).__LF_DETERMINISTIC_IDS__ = true;
  resetDeterministicCounter();
}

console.log('\n=== deterministic-ids (generateId) ===\n');

clearDeterministicMode();
const r1 = generateId();
const r2 = generateId();
assert(r1 !== r2, 'Without deterministic mode, two generateId() values differ');
resetDeterministicCounter();

setOnlyEnvVar();
assert(generateId() === 'det-000001' && generateId() === 'det-000002', 'Env LASERFORGE_DETERMINISTIC_IDS=1 yields det-000001, det-000002');

setOnlyGlobalFlag();
assert(
  generateId() === 'det-000001' && generateId() === 'det-000002',
  'globalThis.__LF_DETERMINISTIC_IDS__=true yields det-000001, det-000002 (env unset)',
);

setOnlyEnvVar();
assert(generateId() === 'det-000001' && generateId() === 'det-000002' && generateId() === 'det-000003', 'Monotonic sequence with env var');
resetDeterministicCounter();
assert(
  generateId() === 'det-000001',
  'resetDeterministicCounter() restarts at det-000001',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
