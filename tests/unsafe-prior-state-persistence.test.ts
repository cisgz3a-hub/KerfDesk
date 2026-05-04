/**
 * T1-29: persisted unsafe-prior-state flag across reconnects.
 *
 * `MachineService.startValidatedJob` sets a localStorage flag at job-begin;
 * three clean-shutdown paths clear it: job completion (terminal status),
 * service disconnect, and failed-start cleanup. App.tsx reads the flag at
 * startup and surfaces a recovery dialog before allowing connect.
 *
 * Run: npx tsx tests/unsafe-prior-state-persistence.test.ts
 */
import {
  setUnsafePriorState,
  getUnsafePriorState,
  clearUnsafePriorState,
  UNSAFE_PRIOR_STATE_KEY_FOR_TESTS,
} from '../src/app/unsafePriorState';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T1-29 unsafe-prior-state persistence ===\n');

const memoryStore: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length(): number { return Object.keys(memoryStore).length; },
  key: (i: number) => Object.keys(memoryStore)[i] ?? null,
  getItem: (k: string) => (k in memoryStore ? memoryStore[k] : null),
  setItem: (k: string, v: string) => { memoryStore[k] = v; },
  removeItem: (k: string) => { delete memoryStore[k]; },
  clear: () => { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
};

async function run(): Promise<void> {

// ── 1. setUnsafePriorState writes to localStorage ──
{
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  setUnsafePriorState({ kind: 'job-running', ticketId: 't-1', startedAt: 1700000000000 });
  const raw = memoryStore[UNSAFE_PRIOR_STATE_KEY_FOR_TESTS];
  assert(raw != null, 'flag persisted to localStorage');
  const parsed = JSON.parse(raw);
  assert(parsed.kind === 'job-running', 'kind = job-running');
  assert(parsed.ticketId === 't-1', 'ticketId persisted');
  assert(parsed.startedAt === 1700000000000, 'startedAt persisted');
}

// ── 2. getUnsafePriorState reads it back ──
{
  const out = getUnsafePriorState();
  assert(out != null, 'getUnsafePriorState returns the persisted state');
  assert(out?.kind === 'job-running', 'kind round-trips');
  assert(out?.ticketId === 't-1', 'ticketId round-trips');
}

// ── 3. clearUnsafePriorState removes it ──
{
  clearUnsafePriorState();
  assert(memoryStore[UNSAFE_PRIOR_STATE_KEY_FOR_TESTS] === undefined,
    'flag removed from localStorage');
  assert(getUnsafePriorState() === null,
    'getUnsafePriorState returns null after clear');
}

// ── 4. malformed JSON → null (no crash) ──
{
  memoryStore[UNSAFE_PRIOR_STATE_KEY_FOR_TESTS] = 'not-valid-json{';
  const out = getUnsafePriorState();
  assert(out === null, 'malformed JSON returns null instead of throwing');
  clearUnsafePriorState();
}

// ── 5. structurally invalid object (wrong kind) → null ──
{
  memoryStore[UNSAFE_PRIOR_STATE_KEY_FOR_TESTS] =
    JSON.stringify({ kind: 'wrong', startedAt: 0 });
  const out = getUnsafePriorState();
  assert(out === null, 'wrong kind value returns null');
  clearUnsafePriorState();
}

// ── 6. missing ticketId tolerated (becomes null in result) ──
{
  memoryStore[UNSAFE_PRIOR_STATE_KEY_FOR_TESTS] =
    JSON.stringify({ kind: 'job-running', startedAt: 12345 });
  const out = getUnsafePriorState();
  assert(out != null, 'kind + startedAt without ticketId still parses');
  assert(out?.ticketId === null, 'missing ticketId becomes null');
  clearUnsafePriorState();
}

// ── 7. Source-level pin: MachineService set/clear hooks at the right places ──
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const svcSrc = fs.readFileSync(
    path.resolve(here, '../src/app/MachineService.ts'),
    'utf-8',
  );

  assert(/T1-29/.test(svcSrc), 'T1-29 marker present in MachineService.ts');
  assert(/import \{ setUnsafePriorState, clearUnsafePriorState \}/.test(svcSrc),
    'MachineService imports the persistence helpers');

  // setUnsafePriorState called with kind: 'job-running' inside startValidatedJob.
  assert(
    /setUnsafePriorState\(\{[\s\S]{0,200}kind: 'job-running'/.test(svcSrc),
    'startValidatedJob calls setUnsafePriorState with kind=job-running',
  );

  // clearUnsafePriorState called in three places: tryFinalizeJobLog (terminal
  // status), disconnect (clean shutdown), and the failed-start catch.
  const clearCount = (svcSrc.match(/clearUnsafePriorState\(\)/g) ?? []).length;
  assert(clearCount >= 3,
    `clearUnsafePriorState called at >= 3 sites (got ${clearCount}: tryFinalize / disconnect / failed-start)`);

  // App.tsx reads the flag at startup.
  const appSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/components/App.tsx'),
    'utf-8',
  );
  assert(/getUnsafePriorState/.test(appSrc),
    'App.tsx reads getUnsafePriorState at startup');
  assert(/Previous session ended unexpectedly/.test(appSrc),
    'App.tsx surfaces "Previous session ended unexpectedly" recovery alert');
  assert(
    /clearUnsafePriorState\(\)/.test(appSrc),
    'App.tsx clears the flag after the user dismisses the alert',
  );
  assert(
    /Inspect the machine/i.test(appSrc),
    'recovery alert message names "Inspect the machine" remediation',
  );
}

// ── 8. localStorage write throwing is swallowed (does not break the caller) ──
{
  const original = (globalThis as unknown as { localStorage: Storage }).localStorage;
  // Replace localStorage with a setItem that throws.
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    ...original,
    setItem: () => { throw new Error('quota exceeded'); },
  } as unknown as Storage;
  let threw = false;
  try {
    setUnsafePriorState({ kind: 'job-running', ticketId: null, startedAt: 0 });
  } catch {
    threw = true;
  }
  assert(!threw, 'setUnsafePriorState swallows localStorage exceptions');
  // Restore.
  (globalThis as unknown as { localStorage: Storage }).localStorage = original;
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
