/**
 * T2-105: crash-loop detection + safe-mode trigger. Pre-T2-105 there
 * was no startup-attempt accounting — when the app failed to open,
 * the user's only recourse was reinstall. Audit 5B Critical 9 + P13.
 *
 * Run: npx tsx tests/startup-diagnostics.test.ts
 */
import {
  emptyCrashLoopState,
  recordStartupAttempt,
  recordSuccessfulStart,
  recordCrash,
  reconcileOnBoot,
  consecutiveCrashCount,
  shouldEnterSafeMode,
  clearCrashLoop,
  formatStartupLogLine,
  DEFAULT_OPTIONS,
} from '../src/diagnostics/CrashLoopDetector';

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

console.log('\n=== T2-105 Startup diagnostics + safe mode ===\n');

void (async () => {

// 1. emptyCrashLoopState: empty history
{
  const s = emptyCrashLoopState();
  assert(Array.isArray(s.attempts) && s.attempts.length === 0,
    'emptyCrashLoopState: attempts is empty array');
  assert(s.resetGenerationAt === undefined,
    'emptyCrashLoopState: resetGenerationAt undefined');
}

// 2. recordStartupAttempt: appends in-progress entry
{
  const s = recordStartupAttempt(emptyCrashLoopState(), 1000);
  assert(s.attempts.length === 1, '1 attempt after record');
  assert(s.attempts[0].outcome === 'in-progress',
    `outcome='in-progress' (got ${s.attempts[0].outcome})`);
  assert(s.attempts[0].startedAt === 1000, `startedAt=1000`);
}

// 3. recordSuccessfulStart: latest attempt → success
{
  let s = recordStartupAttempt(emptyCrashLoopState(), 1000);
  s = recordSuccessfulStart(s);
  assert(s.attempts[0].outcome === 'success',
    `latest attempt outcome → success (got ${s.attempts[0].outcome})`);
}

// 4. recordCrash: latest attempt → crash with reason
{
  let s = recordStartupAttempt(emptyCrashLoopState(), 1000);
  s = recordCrash(s, 'TypeError: undefined');
  assert(s.attempts[0].outcome === 'crash', 'outcome=crash');
  assert(s.attempts[0].reason === 'TypeError: undefined',
    `reason captured (got '${s.attempts[0].reason}')`);
}

// 5. reconcileOnBoot: stale in-progress → crash
{
  const stale = recordStartupAttempt(emptyCrashLoopState(), 1000);
  const { state, recoveredCrashes } = reconcileOnBoot(stale);
  assert(state.attempts[0].outcome === 'crash',
    `stale in-progress → crash (got ${state.attempts[0].outcome})`);
  assert(recoveredCrashes === 1, `1 recovered crash (got ${recoveredCrashes})`);
  assert(state.attempts[0].reason?.includes('host died') === true,
    `default reason names 'host died' (got '${state.attempts[0].reason}')`);
}

// 6. reconcileOnBoot: no-op when nothing in-progress
{
  let s = recordStartupAttempt(emptyCrashLoopState(), 1000);
  s = recordSuccessfulStart(s);
  const { recoveredCrashes } = reconcileOnBoot(s);
  assert(recoveredCrashes === 0, 'no in-progress → 0 recovered');
}

// 7. consecutiveCrashCount: 0 on fresh state
{
  assert(consecutiveCrashCount(emptyCrashLoopState()) === 0,
    'empty state: 0 consecutive crashes');
}

// 8. consecutiveCrashCount: counts trailing crashes
{
  let s = emptyCrashLoopState();
  s = recordStartupAttempt(s, 1000);
  s = recordCrash(s, 'a');
  s = recordStartupAttempt(s, 2000);
  s = recordCrash(s, 'b');
  s = recordStartupAttempt(s, 3000);
  s = recordCrash(s, 'c');
  assert(consecutiveCrashCount(s) === 3,
    `3 crashes in a row (got ${consecutiveCrashCount(s)})`);
}

// 9. consecutiveCrashCount: success resets count
{
  let s = emptyCrashLoopState();
  s = recordStartupAttempt(s, 1000); s = recordCrash(s, 'a');
  s = recordStartupAttempt(s, 2000); s = recordCrash(s, 'b');
  s = recordStartupAttempt(s, 3000); s = recordSuccessfulStart(s);
  s = recordStartupAttempt(s, 4000); s = recordCrash(s, 'c');
  assert(consecutiveCrashCount(s) === 1,
    `success between crashes resets count (got ${consecutiveCrashCount(s)})`);
}

// 10. shouldEnterSafeMode: false at 0 crashes
{
  assert(!shouldEnterSafeMode(emptyCrashLoopState()),
    'empty state: safe mode = false');
}

// 11. shouldEnterSafeMode: false at threshold-1, true at threshold (3)
{
  let s = emptyCrashLoopState();
  for (let i = 0; i < 2; i++) {
    s = recordStartupAttempt(s, 1000 + i);
    s = recordCrash(s, 'x');
  }
  assert(!shouldEnterSafeMode(s),
    `2 crashes (threshold-1): safe mode = false`);
  s = recordStartupAttempt(s, 1010);
  s = recordCrash(s, 'x');
  assert(shouldEnterSafeMode(s),
    `3 crashes (threshold): safe mode = true`);
}

// 12. clearCrashLoop: resets the count via barrier
{
  let s = emptyCrashLoopState();
  for (let i = 0; i < 3; i++) {
    s = recordStartupAttempt(s, 1000 + i);
    s = recordCrash(s, 'x');
  }
  assert(shouldEnterSafeMode(s), 'before clear: safe mode active');
  s = clearCrashLoop(s, 5000);
  assert(consecutiveCrashCount(s) === 0,
    `after clear: 0 consecutive (got ${consecutiveCrashCount(s)})`);
  assert(!shouldEnterSafeMode(s), 'after clear: safe mode = false');
}

// 13. clearCrashLoop: NEW crashes after the barrier still count
{
  let s = emptyCrashLoopState();
  for (let i = 0; i < 3; i++) {
    s = recordStartupAttempt(s, 1000 + i);
    s = recordCrash(s, 'x');
  }
  s = clearCrashLoop(s, 5000);
  s = recordStartupAttempt(s, 6000);
  s = recordCrash(s, 'new');
  assert(consecutiveCrashCount(s) === 1,
    `post-clear new crash counted (got ${consecutiveCrashCount(s)})`);
}

// 14. recordStartupAttempt: maxHistory trims oldest
{
  let s = emptyCrashLoopState();
  const opts = { ...DEFAULT_OPTIONS, maxHistory: 5 };
  for (let i = 0; i < 12; i++) {
    s = recordStartupAttempt(s, 1000 + i, opts);
    s = recordSuccessfulStart(s);
  }
  assert(s.attempts.length === 5,
    `maxHistory=5: only 5 retained (got ${s.attempts.length})`);
  assert(s.attempts[0].startedAt === 1000 + 7,
    `oldest retained = startedAt 1007 (got ${s.attempts[0].startedAt})`);
}

// 15. End-to-end: 3 silent crashes via stale in-progress trigger safe mode
{
  let s = emptyCrashLoopState();
  // Boot 1: started, never recorded success or crash (host died)
  s = recordStartupAttempt(s, 1000);
  // Boot 2: reconciles → crash; tries again, host dies again
  s = reconcileOnBoot(s).state;
  s = recordStartupAttempt(s, 2000);
  s = reconcileOnBoot(s).state;
  s = recordStartupAttempt(s, 3000);
  s = reconcileOnBoot(s).state;
  assert(consecutiveCrashCount(s) === 3,
    `3 silent crashes counted via reconcile (got ${consecutiveCrashCount(s)})`);
  assert(shouldEnterSafeMode(s),
    `3 silent crashes → safe mode = true`);
}

// 16. formatStartupLogLine: ISO-prefixed, level + message
{
  const line = formatStartupLogLine({
    at: Date.parse('2026-05-05T00:00:00.000Z'),
    level: 'CRASH',
    message: 'TypeError: x',
  });
  assert(line.startsWith('[2026-05-05T00:00:00.000Z] CRASH: TypeError: x'),
    `formatted line shape (got '${line.trim()}')`);
  assert(line.endsWith('\n'), `trailing newline for append-mode log`);
}

// 17. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/diagnostics/CrashLoopDetector.ts'), 'utf-8');
  assert(/T2-105/.test(src), 'T2-105 marker in CrashLoopDetector.ts');
  for (const id of [
    'CrashLoopState', 'StartupAttempt', 'recordStartupAttempt',
    'recordSuccessfulStart', 'recordCrash', 'reconcileOnBoot',
    'consecutiveCrashCount', 'shouldEnterSafeMode', 'clearCrashLoop',
    'formatStartupLogLine', 'DEFAULT_OPTIONS',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  assert(/safeModeThreshold:\s*3/.test(src),
    'DEFAULT_OPTIONS.safeModeThreshold=3 (audit recommendation)');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
