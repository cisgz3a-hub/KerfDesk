/**
 * T1-136: regression test for the pure approval-nonce store pruner
 * extracted from `MachineService.pruneConsumedApprovalNonces`.
 *
 * The consumed-nonce Map is the single-use guarantee behind T1-6
 * approval tokens. Two contracts the pruner enforces:
 *   1. Drop entries past their `expiresAt`.
 *   2. Hard-cap the map at `cap` via FIFO eviction.
 *
 * Pre-T1-136 these rules lived inside a private method of the
 * 1924-line MachineService; testing them required mounting the
 * service. Post-T1-136 every branch is testable with a synthetic Map.
 *
 * Run: npx tsx tests/approval-nonce-store.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MAX_CONSUMED_APPROVAL_NONCES,
  pruneApprovalNonceStore,
} from '../src/app/approvalNonceStore';

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

console.log('\n=== T1-136 approval-nonce store pruner ===\n');

// -------- 1. default cap is 512 --------
{
  assert(DEFAULT_MAX_CONSUMED_APPROVAL_NONCES === 512,
    'DEFAULT_MAX_CONSUMED_APPROVAL_NONCES = 512');
}

// -------- 2. empty map → no-op --------
{
  const m = new Map<string, number>();
  pruneApprovalNonceStore(m, 1000, 10);
  assert(m.size === 0, 'empty input → still empty');
}

// -------- 3. expired entry dropped --------
{
  const m = new Map<string, number>();
  m.set('a', 100); // expired
  m.set('b', 200); // expired
  m.set('c', 5000); // alive
  pruneApprovalNonceStore(m, 1000, 10);
  assert(m.size === 1, 'after pruning at now=1000: only "c" remains');
  assert(m.has('c'), 'alive nonce "c" preserved');
  assert(!m.has('a') && !m.has('b'), 'expired nonces dropped');
}

// -------- 4. expiresAt == now is treated as expired --------
{
  const m = new Map<string, number>();
  m.set('a', 1000); // expiresAt === now
  pruneApprovalNonceStore(m, 1000, 10);
  assert(m.size === 0,
    'expiresAt === now → treated as expired (< or = 0 evicts)');
}

// -------- 5. expiresAt = now + 1 is alive --------
{
  const m = new Map<string, number>();
  m.set('a', 1001);
  pruneApprovalNonceStore(m, 1000, 10);
  assert(m.size === 1, 'expiresAt > now → preserved');
}

// -------- 6. hard cap FIFO eviction --------
{
  const m = new Map<string, number>();
  // 5 entries, all alive
  m.set('first', 9999);
  m.set('second', 9999);
  m.set('third', 9999);
  m.set('fourth', 9999);
  m.set('fifth', 9999);
  pruneApprovalNonceStore(m, 0, 3);
  assert(m.size === 3, 'over-cap map shrunk to cap (3)');
  // Oldest entries evicted (insertion order)
  assert(!m.has('first') && !m.has('second'),
    'first/second (oldest) evicted by FIFO');
  assert(m.has('third') && m.has('fourth') && m.has('fifth'),
    'third/fourth/fifth (newest) preserved');
}

// -------- 7. combined: TTL eviction + cap eviction --------
{
  const m = new Map<string, number>();
  // 5 entries: 2 expired, 3 alive
  m.set('exp1', 100);
  m.set('exp2', 200);
  m.set('alive1', 9999);
  m.set('alive2', 9999);
  m.set('alive3', 9999);
  pruneApprovalNonceStore(m, 1000, 2);
  // After TTL: alive1/alive2/alive3 (3 entries)
  // After cap=2: alive1 evicted (oldest of survivors)
  assert(m.size === 2, 'combined: 5 → 3 (TTL) → 2 (cap)');
  assert(!m.has('alive1'), 'oldest survivor evicted by cap');
  assert(m.has('alive2') && m.has('alive3'),
    'two newest survivors preserved');
}

// -------- 8. cap is applied AFTER TTL --------
{
  const m = new Map<string, number>();
  // 3 entries: 2 expired (oldest by insertion), 1 alive
  m.set('exp1', 100);
  m.set('exp2', 200);
  m.set('alive', 9999);
  // With cap=2 the naive ordering would say "size > 2, evict oldest =
  // exp1" first. But T1-136 contract: TTL runs first, so size after
  // TTL = 1 and the cap step is a no-op.
  pruneApprovalNonceStore(m, 1000, 2);
  assert(m.size === 1, 'TTL first → cap step has nothing left to do');
  assert(m.has('alive'), 'alive entry preserved (not displaced)');
}

// -------- 9. cap=0 evicts everything (degenerate but defined) --------
{
  const m = new Map<string, number>();
  m.set('a', 9999);
  m.set('b', 9999);
  pruneApprovalNonceStore(m, 0, 0);
  assert(m.size === 0, 'cap=0 → all entries evicted');
}

// -------- 10. default cap when not passed --------
{
  const m = new Map<string, number>();
  // Add 514 alive entries; pruner should leave 512.
  for (let i = 0; i < 514; i++) {
    m.set(`nonce-${i}`, 9999);
  }
  pruneApprovalNonceStore(m, 0);
  assert(m.size === DEFAULT_MAX_CONSUMED_APPROVAL_NONCES,
    `default cap applied → 512 entries (got ${m.size})`);
  assert(!m.has('nonce-0') && !m.has('nonce-1'),
    'oldest two (nonce-0, nonce-1) evicted under default cap');
  assert(m.has('nonce-513'), 'newest entry (nonce-513) preserved');
}

// -------- 11. Source-level pin: MachineService delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const svcSrc = readFileSync(
    resolve(here, '../src/app/MachineService.ts'),
    'utf-8',
  );
  assert(/from '\.\/approvalNonceStore'/.test(svcSrc),
    'MachineService imports from approvalNonceStore');
  assert(/pruneApprovalNonceStore\(this\.consumedApprovalNonces/.test(svcSrc),
    'MachineService calls pruneApprovalNonceStore with the consumed-nonce map');
  assert(/T1-136/.test(svcSrc),
    'MachineService carries T1-136 marker');
  // Pre-T1-136 inline FIFO loop is gone. Pin the distinctive
  // `while (this.consumedApprovalNonces.size > MAX_CONSUMED_APPROVAL_NONCES)`
  // signature.
  assert(!/while \(this\.consumedApprovalNonces\.size > MAX_CONSUMED_APPROVAL_NONCES\)/.test(svcSrc),
    'inline FIFO eviction loop is gone from MachineService');

  const helperSrc = readFileSync(
    resolve(here, '../src/app/approvalNonceStore.ts'),
    'utf-8',
  );
  assert(/T1-136/.test(helperSrc),
    'approvalNonceStore carries T1-136 marker');
  assert(/export function pruneApprovalNonceStore/.test(helperSrc),
    'pruneApprovalNonceStore is exported');
  assert(/export const DEFAULT_MAX_CONSUMED_APPROVAL_NONCES = 512/.test(helperSrc),
    'DEFAULT_MAX_CONSUMED_APPROVAL_NONCES = 512 exported');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
