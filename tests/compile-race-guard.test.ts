/**
 * T1-57: useCompileManager.compileGcode must guard against out-of-order
 * async results — an older compile that resolves after a newer one must
 * not overwrite lastResult. The scene tick captured at compile-START
 * (not completion) is what gets stored in lastCompiledRevisionRef so
 * gcodeStale tracking stays honest.
 *
 * Source-level pin: a behavioral test of the race would need controlled
 * mocking of pipelineCompileGcode resolution order, and the helper is
 * imported via a static ESM binding (no live reassignment, no test-only
 * setter exists). This test pins the structural elements that
 * implement the guard so a future refactor cannot silently revert.
 *
 * Run: npx tsx tests/compile-race-guard.test.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const hookPath = resolve(here, '../src/ui/hooks/useCompileManager.ts');
const hookSrc = readFileSync(hookPath, 'utf-8');

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

console.log('\n=== T1-57 compile-race-guard ===\n');

// 1. The monotonic request-id ref is declared.
assert(
  /compileRequestIdRef\s*=\s*useRef\(0\)/.test(hookSrc),
  'compileRequestIdRef = useRef(0) is declared',
);

// 2. T1-57 marker is present for grep.
assert(
  /T1-57/.test(hookSrc),
  'T1-57 marker present in useCompileManager.ts',
);

// Locate the compileGcode body so structural asserts run on just that
// callback rather than the whole file.
const startIdx = hookSrc.indexOf('const compileGcode = useCallback');
assert(startIdx >= 0, 'compileGcode useCallback is defined');
// The next callback declaration marks the end of compileGcode's body.
const nextCallback = hookSrc.indexOf('const compileToolpath', startIdx);
assert(nextCallback > startIdx, 'compileGcode body precedes the next callback');
const compileBody = hookSrc.slice(startIdx, nextCallback);

// 3. The compile bumps the request id at start.
assert(
  /\+\+compileRequestIdRef\.current/.test(compileBody),
  'compileGcode increments compileRequestIdRef at start',
);

// 4. The scene tick is captured at start, not at completion.
assert(
  /const\s+sceneTickAtStart\s*=\s*sceneCompileTickRef\.current/.test(compileBody),
  'sceneTickAtStart captured before await — survives later edits',
);

// 5. After await, the request id is checked. Stale results are dropped.
assert(
  /requestId\s*!==\s*compileRequestIdRef\.current/.test(compileBody),
  'compileGcode rejects stale result via requestId !== current check',
);

// 6. The dropped-result branch logs and returns null without mutating
//    lastResult.
assert(
  /dropping stale compile result/.test(compileBody),
  'stale-result drop logs an info message for diagnosability',
);

// 7. lastCompiledRevisionRef is set to the START tick, NOT the
//    completion tick. This is the exact mistake the audit identified.
assert(
  /lastCompiledRevisionRef\.current\s*=\s*sceneTickAtStart/.test(compileBody),
  'lastCompiledRevisionRef set to sceneTickAtStart (audit Race 1 fix)',
);
assert(
  !/lastCompiledRevisionRef\.current\s*=\s*sceneCompileTickRef\.current/.test(compileBody),
  'lastCompiledRevisionRef NOT set to sceneCompileTickRef.current at completion',
);

// 8. The catch path is gated by the request-id check, so an older
//    compile's failure cannot wipe out a newer compile's lastResult.
assert(
  /if\s*\(\s*requestId\s*===\s*compileRequestIdRef\.current\s*\)\s*\{[\s\S]*?setLastResult\(null\)/.test(
    compileBody,
  ),
  'catch path gates setLastResult(null) on requestId === current',
);

// 9. The finally path is gated by the request-id check, so an older
//    compile cannot release setIsCompiling out from under a newer one.
assert(
  /finally[\s\S]*?if\s*\(\s*requestId\s*===\s*compileRequestIdRef\.current\s*\)\s*\{[\s\S]*?setIsCompiling\(false\)/.test(
    compileBody,
  ),
  'finally path gates setIsCompiling(false) on requestId === current',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
