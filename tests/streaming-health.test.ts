/**
 * Streaming health classification (buffer + ack rate).
 */

import { computeStreamingHealth, STREAMING_ACK_WINDOW_MS } from '../src/controllers/grbl/streamingHealth';

const GRBL_CAP = 127;
const NOW = 1_000_000_000;

function spreadInWindow(count: number, offsetMs = 0): number[] {
  const span = STREAMING_ACK_WINDOW_MS - 500;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = NOW - span + offsetMs + (i * span) / Math.max(1, count - 1);
    out.push(t);
  }
  return out;
}

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

console.log('\n=== streaming-health ===\n');

{
  const r = computeStreamingHealth({
    now: NOW,
    ackTimestamps: [],
    sendTimestamps: [],
    bufferFill: 0,
    grblBufferCapacity: GRBL_CAP,
    isJobRunning: false,
  });
  assert(r.healthStatus === 'healthy', 'not running → healthy');
  assert(r.ackRateHz === null, 'no ack samples → null rate');
}

{
  const sends = spreadInWindow(12);
  const acks = spreadInWindow(12);
  const r = computeStreamingHealth({
    now: NOW,
    ackTimestamps: acks,
    sendTimestamps: sends,
    bufferFill: 20,
    grblBufferCapacity: GRBL_CAP,
    isJobRunning: true,
  });
  assert(r.healthStatus === 'healthy', 'balanced sends/acks, low buffer → healthy');
  assert(r.ackRateHz != null && r.expectedAckRateHz != null, 'rates populated');
}

{
  const sends = spreadInWindow(30);
  const acks = spreadInWindow(4);
  const r = computeStreamingHealth({
    now: NOW,
    ackTimestamps: acks,
    sendTimestamps: sends,
    bufferFill: 118,
    grblBufferCapacity: GRBL_CAP,
    isJobRunning: true,
  });
  assert(r.healthStatus === 'saturated', 'ack deficit + buffer >90% → saturated');
}

{
  const sends = spreadInWindow(20);
  const acks = spreadInWindow(12);
  const r = computeStreamingHealth({
    now: NOW,
    ackTimestamps: acks,
    sendTimestamps: sends,
    bufferFill: 40,
    grblBufferCapacity: GRBL_CAP,
    isJobRunning: true,
  });
  assert(r.healthStatus === 'warning', 'ack < 70% of expected → warning');
}

{
  const sends = spreadInWindow(25);
  const acks = spreadInWindow(25);
  const r = computeStreamingHealth({
    now: NOW,
    ackTimestamps: acks,
    sendTimestamps: sends,
    bufferFill: 118,
    grblBufferCapacity: GRBL_CAP,
    isJobRunning: true,
  });
  assert(r.healthStatus !== 'saturated', 'full buffer + matching acks → not saturated (AND gate)');
  assert(r.healthStatus === 'warning', '…still warning from high buffer fill');
}

{
  const r = computeStreamingHealth({
    now: NOW,
    ackTimestamps: [],
    sendTimestamps: [],
    bufferFill: 120,
    grblBufferCapacity: GRBL_CAP,
    isJobRunning: false,
  });
  assert(r.healthStatus === 'healthy', 'cold high buffer when job not running → healthy');
}

console.log(`\n=== Summary ===\nPassed: ${passed}, Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
