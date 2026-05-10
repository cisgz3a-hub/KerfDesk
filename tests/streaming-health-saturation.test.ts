/**
 * T1-125: regression test for the streaming-health rate-saturation
 * bug. Pre-T1-125 the computation was `recentEvents.length /
 * windowSeconds` (where windowSeconds = 5). The producer
 * (GrblController._ackTimestamps) was a fixed 100-sample ring. At
 * high streaming rates (≥ 200 Hz) the ring captured only the most-
 * recent ~0.5 s of events, but the rate formula still divided by
 * 5 s — reporting ~20 Hz when reality was 200 Hz. Worse: the
 * computed expected rate was wrong by the same factor, so health
 * status appeared "healthy" because the false low ack rate matched
 * the false low expected rate, masking truly degraded streams.
 *
 * Fix: endpoint-based rate `(count - 1) / (last - first)` is robust
 * to producer buffer truncation. Producer buffer also bumped to
 * 1000 samples so the 5-second window stays meaningful for trend
 * detection at sustained high rates.
 *
 * Run: npx tsx tests/streaming-health-saturation.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeStreamingHealth,
  STREAMING_ACK_WINDOW_MS,
} from '../src/controllers/grbl/streamingHealth';

const NOW = 1_000_000_000;
const GRBL_CAP = 127;

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

/**
 * Generate timestamps for an event stream at `rateHz` ending at
 * `endMs`, with `count` events. Useful for simulating a producer
 * buffer that's truncated to its most-recent N samples.
 */
function streamAt(rateHz: number, count: number, endMs: number = NOW): number[] {
  const intervalMs = 1000 / rateHz;
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(endMs - i * intervalMs);
  }
  return out;
}

console.log('\n=== T1-125 streaming-health rate-saturation ===\n');

// -------- 1. 100 Hz stream with full window of samples → ~100 Hz reported --------
{
  const acks = streamAt(100, 500); // 100 Hz × 5s = 500 events, fills the window
  const sends = streamAt(100, 500);
  const r = computeStreamingHealth({
    now: NOW,
    ackTimestamps: acks,
    sendTimestamps: sends,
    bufferFill: 50,
    grblBufferCapacity: GRBL_CAP,
    isJobRunning: true,
  });
  // Endpoint-based: (500-1) / 4.99 = ~100.0
  assert(r.ackRateHz != null && Math.abs(r.ackRateHz - 100) < 1,
    `100 Hz × 5s span → reported ~100 Hz (got ${r.ackRateHz?.toFixed(2)})`);
}

// -------- 2. 200 Hz stream with TRUNCATED buffer (audit's exact saturation case) --------
// Producer ring held only 100 samples; at 200 Hz those 100 samples
// span 0.5 s (the most-recent half-second). Pre-T1-125 the formula
// was 100 / 5 = 20 Hz. Endpoint-based: 99 / 0.495 ≈ 200 Hz.
{
  const acks = streamAt(200, 100); // 100 events at 200 Hz = 0.5s span
  const sends = streamAt(200, 100);
  const r = computeStreamingHealth({
    now: NOW,
    ackTimestamps: acks,
    sendTimestamps: sends,
    bufferFill: 50,
    grblBufferCapacity: GRBL_CAP,
    isJobRunning: true,
  });
  assert(r.ackRateHz != null && r.ackRateHz > 150,
    `200 Hz with truncated 100-sample buffer → reported >150 Hz, NOT pre-fix's ~20 Hz (got ${r.ackRateHz?.toFixed(2)})`);
  assert(r.ackRateHz != null && r.ackRateHz < 250,
    `200 Hz reported within 25% of true rate (got ${r.ackRateHz?.toFixed(2)})`);
}

// -------- 3. 50 Hz stream → reported ~50 Hz (mid-range sanity check) --------
{
  const acks = streamAt(50, 250); // 5s span
  const sends = streamAt(50, 250);
  const r = computeStreamingHealth({
    now: NOW,
    ackTimestamps: acks,
    sendTimestamps: sends,
    bufferFill: 50,
    grblBufferCapacity: GRBL_CAP,
    isJobRunning: true,
  });
  assert(r.ackRateHz != null && Math.abs(r.ackRateHz - 50) < 1,
    `50 Hz stream → reported ~50 Hz (got ${r.ackRateHz?.toFixed(2)})`);
}

// -------- 4. ≤2 timestamps → null rate (matches pre-T1-125 floor) --------
{
  const r = computeStreamingHealth({
    now: NOW,
    ackTimestamps: [NOW - 1000, NOW],
    sendTimestamps: [NOW - 1000, NOW],
    bufferFill: 50,
    grblBufferCapacity: GRBL_CAP,
    isJobRunning: true,
  });
  assert(r.ackRateHz === null,
    'fewer than 3 timestamps → ackRateHz null (preserves pre-T1-125 floor)');
  assert(r.expectedAckRateHz === null,
    'fewer than 3 send timestamps → expectedAckRateHz null');
}

// -------- 5. All-coincident timestamps (degenerate) → null rate --------
{
  const acks = [NOW, NOW, NOW, NOW, NOW];
  const sends = [NOW, NOW, NOW, NOW, NOW];
  const r = computeStreamingHealth({
    now: NOW,
    ackTimestamps: acks,
    sendTimestamps: sends,
    bufferFill: 50,
    grblBufferCapacity: GRBL_CAP,
    isJobRunning: true,
  });
  assert(r.ackRateHz === null,
    'coincident timestamps (zero span) → null rate (avoid divide-by-zero)');
}

// -------- 6. Saturated stream now correctly classified at high rates --------
// Pre-T1-125, a 200 Hz stream that was actually degraded (acks at 80
// Hz against expected 200) would compute as 16 Hz acks vs 20 Hz
// expected — both depressed by the same 5× factor — and report
// "warning" or even "healthy" depending on the ratio. Post-T1-125
// the endpoint-based formula gives true rates so the deficit is
// visible.
{
  // 200 Hz expected, 80 Hz actual — degraded ~60%
  const sends = streamAt(200, 100); // 100 events, 0.5s span = 200 Hz
  const acks = streamAt(80, 40);    // 40 events, 0.4875s span = ~80 Hz
  const r = computeStreamingHealth({
    now: NOW,
    ackTimestamps: acks,
    sendTimestamps: sends,
    bufferFill: 120, // ~94% of GRBL_CAP=127
    grblBufferCapacity: GRBL_CAP,
    isJobRunning: true,
  });
  assert(r.ackRateHz != null && r.ackRateHz < 100,
    `degraded ack stream rates as <100 Hz (got ${r.ackRateHz?.toFixed(2)})`);
  assert(r.expectedAckRateHz != null && r.expectedAckRateHz > 150,
    `expected stream rates as >150 Hz (got ${r.expectedAckRateHz?.toFixed(2)})`);
  assert(r.healthStatus === 'saturated',
    `200 Hz expected vs 80 Hz actual + 94% buffer → saturated (got '${r.healthStatus}')`);
}

// -------- 7. Window cutoff works: events older than 5s are excluded --------
{
  // Mix old + recent events. Old events would inflate the count if
  // they slipped past the cutoff filter.
  const oldAcks = streamAt(100, 100, NOW - STREAMING_ACK_WINDOW_MS - 5000); // 10s old
  const recentAcks = streamAt(50, 50); // recent 1s @ 50 Hz
  const sends = streamAt(50, 50);
  const r = computeStreamingHealth({
    now: NOW,
    ackTimestamps: [...oldAcks, ...recentAcks],
    sendTimestamps: sends,
    bufferFill: 50,
    grblBufferCapacity: GRBL_CAP,
    isJobRunning: true,
  });
  // Should report ~50 Hz from the recent slice, NOT a blend of old+recent.
  assert(r.ackRateHz != null && Math.abs(r.ackRateHz - 50) < 5,
    `window cutoff excludes old samples; reports rate from recent slice (got ${r.ackRateHz?.toFixed(2)})`);
}

// -------- Source-level pin: producer buffer was bumped --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const ctlSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );
  assert(/ACK_RATE_WINDOW_SIZE\s*=\s*1000/.test(ctlSrc),
    'GrblController bumped ACK_RATE_WINDOW_SIZE to 1000 (was 100, audit-flagged saturation point)');
  assert(/T1-125/.test(ctlSrc),
    'GrblController carries T1-125 marker on the buffer-size constant');

  const healthSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/streamingHealth.ts'),
    'utf-8',
  );
  assert(/T1-125/.test(healthSrc),
    'streamingHealth carries T1-125 marker on the rate-formula change');
  assert(/rateFromTimestamps/.test(healthSrc),
    'rateFromTimestamps helper exists (endpoint-based rate)');
  // Pre-fix divide-by-windowSeconds is gone from the live code path.
  assert(
    !/recentAcks\.length\s*\/\s*windowSeconds/.test(healthSrc),
    'pre-fix `recentAcks.length / windowSeconds` formula is gone',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
