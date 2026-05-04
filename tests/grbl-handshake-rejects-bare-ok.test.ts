/**
 * T1-51: GRBL handshake must NOT accept a bare `ok` as welcome. The
 * pre-fix predicate let any device that responded `ok` to a probe
 * pass the handshake — modems, industrial controllers, even loopback
 * cables echoing STDIN. A non-GRBL device would then "connect" in the
 * UI while subsequent polling and `$$` parsing produced silent
 * nonsense. The fix removes the `line === 'ok'` clause so welcome
 * requires a GRBL-shaped line: banner substring, `[VER:]`/`[OPT:]`/
 * `[MSG:]` blocks, or a parseable `<State|MPos:...>` realtime status.
 *
 * Source-level pin: a behavioral test would need a JSDOM/Mock
 * pipeline that simulates a non-GRBL responder, plus the connect
 * timeout (10s+ default). The structural pin asserts the predicate
 * shape directly so a future revert is caught.
 *
 * Hardware verification needed — Falcon A1 Pro front-origin burn test.
 * (The Falcon is a well-known GRBL device; verify connect still
 * succeeds. The non-GRBL false-positive is observation-only — verify
 * by attempting to connect to a non-laser USB-serial device and
 * observing the connect fails rather than producing "Connected".)
 *
 * Run: npx tsx tests/grbl-handshake-rejects-bare-ok.test.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const path = resolve(here, '../src/controllers/grbl/GrblController.ts');
const src = readFileSync(path, 'utf-8');

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

console.log('\n=== T1-51 GRBL handshake rejects bare ok ===\n');

// Locate the welcome predicate in the connect's onData handler.
const predicateStart = src.indexOf('const isWelcome =');
assert(predicateStart >= 0, 'isWelcome predicate is defined in connect()');

// Find the predicate body (semicolon-terminated assignment).
const predicateEnd = src.indexOf(';', predicateStart);
assert(predicateEnd > predicateStart, 'isWelcome predicate body terminates');
const predicate = src.slice(predicateStart, predicateEnd);

// 1. The bare `ok` clause is GONE.
assert(!/line\s*===\s*'ok'/.test(predicate),
  'isWelcome predicate no longer accepts bare `ok` (the T1-51 fix)');

// 2. The legitimate GRBL-shaped clauses are still there.
assert(/line\.toLowerCase\(\)\.includes\('grbl'\)/.test(predicate),
  'isWelcome still accepts GRBL banner substring (`grbl` lowercased)');
assert(/line\.startsWith\('\[VER:'\)/.test(predicate),
  'isWelcome still accepts `[VER:` block ($I version response)');
assert(/line\.startsWith\('\[MSG:'\)/.test(predicate),
  'isWelcome still accepts `[MSG:` block (GRBL message)');
assert(/isGrblStatusWelcome/.test(predicate),
  'isWelcome still accepts a parseable `<State|MPos:...>` realtime status');

// 3. T1-51 added `[OPT:` (the second half of $I) for symmetry with [VER:.
assert(/line\.startsWith\('\[OPT:'\)/.test(predicate),
  'isWelcome accepts `[OPT:` block ($I option response — added by T1-51)');

// 4. T1-51 marker is present in the comment for grep discoverability.
const surroundingContext = src.slice(Math.max(0, predicateStart - 1500), predicateStart);
assert(/T1-51/.test(surroundingContext),
  'T1-51 marker present in the comment immediately above the predicate');

// 5. The bare `ok` handling elsewhere in the controller (ok-acks during
//    streaming, $$ termination, $# termination) is intentionally
//    untouched — those paths are post-handshake and depend on `ok` as
//    GRBL's protocol acknowledgment. Spot-check that they still exist.
const okAckCount = (src.match(/if\s*\(\s*line\s*===\s*'ok'\s*\)/g) ?? []).length;
assert(okAckCount >= 3,
  `bare-ok ack handling preserved post-handshake (found ${okAckCount} sites — should be ≥3 for $$ / $# / streaming acks)`);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
