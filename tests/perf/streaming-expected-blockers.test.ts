/**
 * T3-40 documents the performance cases that cannot honestly pass until the
 * T3-15 spool/streaming architecture exists.
 *
 * Run: npx tsx tests/perf/streaming-expected-blockers.test.ts
 */
import { test } from 'node:test';

test.skip('T3-40/T3-15: million-line fake GRBL streaming keeps buffers and logs bounded', () => {
  // Requires the future spool/streaming job architecture from T3-15.
});

test.skip('T3-40/T3-15: million-line G-code export is streaming or explicitly memory-bounded', () => {
  // Current output generation returns one giant string; T3-15 is the honest fix.
});

test.skip('T3-40/T2-17/T3-15: cancellation latency is measured inside million-line streaming', () => {
  // Current cancellation checkpoints exist in compile/plan/output loops, but
  // low-latency streaming cancellation needs the T3-15 sender/spool layer.
});
