/**
 * T3-15: emitted burn-envelope analysis must be able to consume the
 * replayable G-code spool without flattening the job back into a
 * single string. This guards the compile-time safety check while the
 * output pipeline moves from materialized G-code toward streamed
 * spools.
 *
 * Run: npx tsx tests/emitted-burn-envelope-stream.test.ts
 */
import { analyzeEmittedBurnEnvelope, analyzeEmittedBurnEnvelopeFromChunks } from '../src/core/output/emittedBurnEnvelope';
import type { GcodeChunk } from '../src/core/output/GcodeStreaming';

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

console.log('\n=== T3-15 emitted-burn-envelope streaming parser ===\n');

async function* chunks(): AsyncGenerator<GcodeChunk, void, void> {
  yield {
    lines: ['G21', 'G90', 'M5 S0', 'G0 X10 Y10', 'M4 S500'],
    cumulativeLineCount: 5,
    isLast: false,
  };
  yield {
    lines: ['G1 X20 Y10 F1200', 'G91', 'G1 X0 Y5', 'G90'],
    cumulativeLineCount: 9,
    isLast: false,
  };
  yield {
    lines: ['M5 S0', 'G1 X200 Y200', 'M2'],
    cumulativeLineCount: 12,
    isLast: true,
  };
}

const flat = [
  'G21', 'G90', 'M5 S0', 'G0 X10 Y10', 'M4 S500',
  'G1 X20 Y10 F1200', 'G91', 'G1 X0 Y5', 'G90',
  'M5 S0', 'G1 X200 Y200', 'M2',
].join('\n');

async function main(): Promise<void> {
  const streamed = await analyzeEmittedBurnEnvelopeFromChunks(chunks());
  const materialized = analyzeEmittedBurnEnvelope(flat);

  assert(
    JSON.stringify(streamed) === JSON.stringify(materialized),
    'streamed analyzer matches materialized analyzer across chunk modal state',
  );
  assert(streamed.burnMoveCount === 2, `streamed analyzer counts 2 burn moves (got ${streamed.burnMoveCount})`);
  assert(streamed.burnBounds !== null, 'streamed analyzer returns burn bounds');
  if (streamed.burnBounds) {
    assert(streamed.burnBounds.minX === 10, `streamed minX === 10 (got ${streamed.burnBounds.minX})`);
    assert(streamed.burnBounds.maxX === 20, `streamed maxX === 20 (got ${streamed.burnBounds.maxX})`);
    assert(streamed.burnBounds.minY === 10, `streamed minY === 10 (got ${streamed.burnBounds.minY})`);
    assert(streamed.burnBounds.maxY === 15, `streamed maxY === 15 (got ${streamed.burnBounds.maxY})`);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
