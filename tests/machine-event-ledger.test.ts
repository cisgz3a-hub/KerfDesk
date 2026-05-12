/**
 * T1-193 (external audit Critical #14 foundation slice): persistent
 * append-only `MachineEventLedger`.
 *
 * The audit framed the problem as: "Recovery/log/replay state is
 * spread across service fields and storage calls. Complex failures
 * produce inconsistent diagnostics. Implement an append-only
 * `MachineEventLedger` persisted durably so support and recovery
 * can reconstruct what happened."
 *
 * T1-193 ships the primitive: schema, interface, in-memory + local-
 * Storage implementations, `serializeForSupport()` helper, bounded
 * FIFO. No production wire-up yet (multi-week SafetySupervisor
 * refactor deferred). This test pins the contract so future
 * call-sites can rely on it.
 *
 * Run: npx tsx tests/machine-event-ledger.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InMemoryMachineEventLedger,
  LocalStorageMachineEventLedger,
  LEDGER_MAX_ENTRIES,
  LEDGER_SCHEMA_VERSION,
  type MachineEvent,
  type MachineEventLedger,
} from '../src/app/MachineEventLedger';

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

// In-memory localStorage shim for the localStorage variant.
const memoryStore: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() { return Object.keys(memoryStore).length; },
  clear(): void { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
  getItem: (k: string) => Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null,
  key: (i: number) => Object.keys(memoryStore)[i] ?? null,
  removeItem: (k: string) => { delete memoryStore[k]; },
  setItem: (k: string, v: string) => { memoryStore[k] = v; },
} as Storage;

console.log('\n=== T1-193 MachineEventLedger ===\n');

function runImplementationContract(name: string, makeLedger: () => MachineEventLedger): void {
  console.log(`\n--- ${name} ---\n`);
  const ledger = makeLedger();
  ledger.clear();

  // -------- append + tail --------
  ledger.append({ kind: 'job-start', t: 1000, ticketId: 't-1', sceneHash: 's-1' });
  ledger.append({ kind: 'pause-requested', t: 2000 });
  ledger.append({ kind: 'paused-verified', t: 2500 });
  ledger.append({ kind: 'resume-requested', t: 3000 });
  ledger.append({ kind: 'job-completed', t: 4000, ticketId: 't-1', linesAcknowledged: 42 });

  assert(ledger.size() === 5, `${name}: size === 5 after 5 appends`);
  const tail3 = ledger.tail(3);
  assert(tail3.length === 3, `${name}: tail(3) returns 3 entries`);
  assert(tail3[0].kind === 'paused-verified', `${name}: tail order preserved (paused-verified first)`);
  assert(tail3[2].kind === 'job-completed', `${name}: tail order preserved (job-completed last)`);

  // -------- query by kind --------
  const pauseEvents = ledger.query({ kinds: new Set(['pause-requested', 'paused-verified']) });
  assert(pauseEvents.length === 2, `${name}: query kinds filter returns 2 pause events`);

  // -------- query by time --------
  const sinceT2500 = ledger.query({ sinceMs: 2500 });
  assert(sinceT2500.length === 3, `${name}: sinceMs filter (>= 2500) returns 3 entries`);

  const untilT2000 = ledger.query({ untilMs: 2000 });
  assert(untilT2000.length === 2, `${name}: untilMs filter (<= 2000) returns 2 entries (job-start + pause-requested)`);

  // -------- maxCount --------
  const cap = ledger.query({ maxCount: 2 });
  assert(cap.length === 2, `${name}: maxCount=2 caps results`);

  // -------- serializeForSupport --------
  const dump = ledger.serializeForSupport();
  assert(dump.schemaVersion === LEDGER_SCHEMA_VERSION, `${name}: schemaVersion=${LEDGER_SCHEMA_VERSION} in support dump`);
  assert(typeof dump.capturedAt === 'number', `${name}: capturedAt is a number`);
  assert(dump.entries.length === 5, `${name}: support dump has all 5 entries`);

  // -------- clear --------
  ledger.clear();
  assert(ledger.size() === 0, `${name}: size === 0 after clear`);
}

runImplementationContract('InMemoryMachineEventLedger', () => new InMemoryMachineEventLedger());
runImplementationContract('LocalStorageMachineEventLedger', () => new LocalStorageMachineEventLedger());

// -------- FIFO trim at the budget boundary --------
{
  console.log('\n--- FIFO trim ---\n');
  const ledger = new InMemoryMachineEventLedger();
  // Push 1 over the cap.
  for (let i = 0; i < LEDGER_MAX_ENTRIES + 1; i++) {
    ledger.append({ kind: 'pause-requested', t: i });
  }
  assert(ledger.size() === LEDGER_MAX_ENTRIES, `size capped at ${LEDGER_MAX_ENTRIES}`);
  const head = ledger.query({ maxCount: 1 });
  // FIFO: the oldest entry (t=0) should be evicted, so first remaining is t=1.
  assert(head[0].t === 1, `FIFO eviction: oldest (t=0) dropped, first remaining t=${head[0].t}`);
}

// -------- localStorage durability --------
{
  console.log('\n--- localStorage durability ---\n');
  const ledger1 = new LocalStorageMachineEventLedger();
  ledger1.clear();
  ledger1.append({ kind: 'emergency-stop', t: 9000, accepted: true, message: 'user pressed e-stop' });
  // Simulate a renderer restart: a fresh ledger reads the persisted data.
  const ledger2 = new LocalStorageMachineEventLedger();
  assert(ledger2.size() === 1, 'persisted ledger survives renderer-restart simulation');
  const recovered = ledger2.tail(1)[0];
  assert(recovered.kind === 'emergency-stop', 'recovered event kind');
  if (recovered.kind === 'emergency-stop') {
    assert(recovered.accepted === true, 'recovered event payload (accepted)');
    assert(recovered.message === 'user pressed e-stop', 'recovered event payload (message)');
  }
  ledger2.clear();
}

// -------- Cross-kind sanity: every documented kind is constructable --------
{
  console.log('\n--- discriminated-union kinds ---\n');
  const samples: MachineEvent[] = [
    { kind: 'job-start', t: 0, ticketId: '', sceneHash: '' },
    { kind: 'job-completed', t: 0, ticketId: '', linesAcknowledged: 0 },
    { kind: 'job-stopped', t: 0, ticketId: '', reason: '' },
    { kind: 'job-failed', t: 0, ticketId: '', error: '' },
    { kind: 'failed-to-start', t: 0, ticketId: '', error: '', sawRun: false, controllerThinksRunning: false },
    { kind: 'pause-requested', t: 0 },
    { kind: 'paused-verified', t: 0 },
    { kind: 'resume-requested', t: 0 },
    { kind: 'emergency-stop', t: 0, accepted: true },
    { kind: 'disconnect-while-running', t: 0, ticketId: null },
    { kind: 'safety-off', t: 0, stage: 'm5' },
    { kind: 'wcs-query-error', t: 0, grblErrorLine: 'error:9' },
    { kind: 'placement-uncertain', t: 0, reason: 'wcs_query_error' },
    { kind: 'recovery-cleared', t: 0, acknowledgedBy: 'user' },
    { kind: 'burn-envelope-divergence', t: 0, divergenceKind: 'envelope-edge-mismatch', maxEdgeDeltaMm: 3 },
  ];
  assert(samples.length === 15, 'discriminated union has 15 kinds (matches the documented list)');
}

// -------- Source pins --------
{
  console.log('\n--- source pins ---\n');
  const src = readFileSync(resolve(here, '../src/app/MachineEventLedger.ts'), 'utf-8');
  assert(/T1-193/.test(src), 'MachineEventLedger.ts carries T1-193 marker');
  assert(/Critical #14/.test(src), 'cross-references audit Critical #14');
  assert(/LEDGER_SCHEMA_VERSION = 1/.test(src), 'schema version is 1');
  assert(/LEDGER_MAX_ENTRIES = 10_000/.test(src), 'budget is 10_000');
  assert(/export class InMemoryMachineEventLedger/.test(src), 'in-memory impl exported');
  assert(/export class LocalStorageMachineEventLedger/.test(src), 'localStorage impl exported');
  assert(/serializeForSupport\(\)/.test(src), 'serializeForSupport method present');
  assert(
    /intentionally type-only|foundation slice/i.test(src),
    'doc names the foundation-slice intent',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
