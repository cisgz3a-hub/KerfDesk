/**
 * T2-86: explicit `FrameState` union type — pin every state's
 * transition + the canStart predicate. Pre-T2-86 frame state was a
 * single boolean and could not express running / failed / fingerprint-
 * mismatch / stale-with-reason distinctions.
 *
 * Run: npx tsx tests/frame-state-transitions.test.ts
 */
import {
  frameStateNone,
  frameStateRunning,
  frameStateValid,
  frameStateStale,
  frameStateFailed,
  frameAllowsStart,
  frameMatchesFingerprint,
  type FrameState,
} from '../src/app/FrameState';

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

const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 50 };

console.log('\n=== T2-86 FrameState transitions ===\n');

void (async () => {

// 1. Builders produce expected discriminants
{
  assert(frameStateNone().status === 'none', 'frameStateNone → status=none');
  const r = frameStateRunning('safe', 1000);
  assert(r.status === 'running' && r.mode === 'safe' && r.startedAt === 1000,
    `frameStateRunning: status=running, mode=safe, startedAt=1000`);
  const v = frameStateValid({ fingerprint: 'fp-1', bounds, mode: 'dot', now: 2000 });
  assert(v.status === 'valid',
    `frameStateValid: status=valid`);
  if (v.status === 'valid') {
    assert(v.fingerprint === 'fp-1' && v.mode === 'dot' && v.completedAt === 2000,
      `frameStateValid: fields populated`);
  }
  const s = frameStateStale('scene-changed');
  assert(s.status === 'stale' && s.reason === 'scene-changed',
    `frameStateStale: reason captured`);
  const f = frameStateFailed('idle-timeout', 3000);
  assert(f.status === 'failed' && f.reason === 'idle-timeout' && f.failedAt === 3000,
    `frameStateFailed: reason + failedAt captured`);
}

// 2. Stale built from a valid state preserves previousFingerprint
{
  const valid = frameStateValid({ fingerprint: 'fp-old', bounds, mode: 'safe' });
  const stale = frameStateStale('scene-changed', valid);
  assert(stale.status === 'stale',
    'stale: status=stale');
  if (stale.status === 'stale') {
    assert(stale.previousFingerprint === 'fp-old',
      `stale: previousFingerprint preserved (got ${stale.previousFingerprint})`);
  }
}

// 3. Stale built from non-valid state has no previousFingerprint
{
  const stale = frameStateStale('manual-invalidate', frameStateNone());
  if (stale.status === 'stale') {
    assert(stale.previousFingerprint === undefined,
      `stale from none: no previousFingerprint`);
  }
}

// 4. frameAllowsStart: only 'valid' returns true
{
  assert(!frameAllowsStart(frameStateNone()), 'none: allowsStart=false');
  assert(!frameAllowsStart(frameStateRunning('safe')), 'running: allowsStart=false');
  assert(frameAllowsStart(frameStateValid({ fingerprint: 'fp', bounds, mode: 'safe' })),
    'valid: allowsStart=true');
  assert(!frameAllowsStart(frameStateStale('scene-changed')),
    'stale: allowsStart=false');
  assert(!frameAllowsStart(frameStateFailed('idle-timeout')),
    'failed: allowsStart=false');
}

// 5. frameMatchesFingerprint: matches only when valid AND fp equal
{
  const v = frameStateValid({ fingerprint: 'fp-1', bounds, mode: 'safe' });
  assert(frameMatchesFingerprint(v, 'fp-1') === true,
    'valid + matching fp: true');
  assert(frameMatchesFingerprint(v, 'fp-different') === false,
    'valid + different fp: false (frame is for a different job)');
  assert(frameMatchesFingerprint(frameStateNone(), 'fp-1') === false,
    'none + any fp: false');
  assert(frameMatchesFingerprint(frameStateStale('scene-changed'), 'fp-1') === false,
    'stale + any fp: false');
}

// 6. canStart-style composition: only valid + matching fp gates start
{
  const states: FrameState[] = [
    frameStateNone(),
    frameStateRunning('safe'),
    frameStateValid({ fingerprint: 'fp-1', bounds, mode: 'safe' }),
    frameStateValid({ fingerprint: 'fp-2', bounds, mode: 'safe' }),
    frameStateStale('scene-changed'),
    frameStateFailed('command-failed'),
  ];
  const currentFp = 'fp-1';
  const allowed = states.map(s => frameAllowsStart(s) && frameMatchesFingerprint(s, currentFp));
  assert(allowed.toString() === [false, false, true, false, false, false].toString(),
    `composition: only valid+matching gates start (got ${allowed.join(',')})`);
}

// 7. All FrameStaleReason values declared
{
  const reasons = ['scene-changed', 'profile-changed', 'origin-changed',
    'startmode-changed', 'undo-redo', 'project-loaded', 'manual-invalidate'];
  for (const r of reasons) {
    const s = frameStateStale(r as Parameters<typeof frameStateStale>[0]);
    if (s.status === 'stale') {
      assert(s.reason === r, `stale reason '${r}' round-trips`);
    }
  }
}

// 8. All FrameFailureReason values declared
{
  const reasons = ['no-controller', 'idle-timeout', 'command-failed',
    'machine-alarm', 'disconnected', 'cancelled', 'unknown'];
  for (const r of reasons) {
    const s = frameStateFailed(r as Parameters<typeof frameStateFailed>[0]);
    if (s.status === 'failed') {
      assert(s.reason === r, `failed reason '${r}' round-trips`);
    }
  }
}

// 9. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/FrameState.ts'), 'utf-8');
  assert(/T2-86/.test(src), 'T2-86 marker in FrameState.ts');
  for (const k of ['none', 'running', 'valid', 'stale', 'failed']) {
    assert(src.includes(`'${k}'`), `FrameState status '${k}' declared`);
  }
  assert(/frameAllowsStart/.test(src) && /frameMatchesFingerprint/.test(src),
    'predicate helpers exported');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
