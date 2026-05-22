/**
 * T3-40 documents the performance cases that cannot honestly pass until the
 * T3-15 spool/streaming architecture exists.
 *
 * Run: npx tsx tests/perf/streaming-expected-blockers.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertMaterializedGcodeWithinLimit,
  MAX_MATERIALIZED_GCODE_BYTES,
  MAX_MATERIALIZED_GCODE_LINES,
} from '../../src/app/PipelineService';
import {
  buildReplayableGcodeSpool,
  type GcodeChunk,
} from '../../src/core/output/GcodeStreaming';

async function* millionLineChunks(totalLines: number, chunkLines: number): AsyncGenerator<GcodeChunk> {
  let emitted = 0;
  while (emitted < totalLines) {
    const take = Math.min(chunkLines, totalLines - emitted);
    const lines: string[] = [];
    for (let i = 0; i < take; i++) {
      lines.push(`G1 X${emitted + i} Y0 F600`);
    }
    emitted += take;
    yield {
      lines,
      cumulativeLineCount: emitted,
      isLast: emitted === totalLines,
    };
  }
}

test('T3-40/T3-15: million-line G-code spool is replayable without a flat line array', async () => {
  const totalLines = 1_000_000;
  const chunkLines = 2_000;
  let factoryCalls = 0;
  const spool = await buildReplayableGcodeSpool('million-line-test', () => {
    factoryCalls++;
    return millionLineChunks(totalLines, chunkLines);
  });

  assert.equal(spool.lineCount, totalLines);
  assert.match(spool.contentHash, /^[0-9a-f]{8}$/);
  assert(spool.byteCount > totalLines * 8);
  assert.equal(spool.usesM4, false, 'spool records M4 usage during the first metadata pass');
  assert.equal(factoryCalls, 1, 'spool metadata is computed by one streaming pass');

  let observed = 0;
  let maxChunk = 0;
  for await (const chunk of spool.open()) {
    observed += chunk.lines.length;
    maxChunk = Math.max(maxChunk, chunk.lines.length);
    if (observed >= 10_000) break;
  }
  assert.equal(observed, 10_000);
  assert.equal(maxChunk, chunkLines);
  assert.equal(factoryCalls, 2, 'open replays through the chunk factory instead of a stored string[]');
});

test('S25-12: spool captures dynamic-power metadata without an extra replay', async () => {
  let factoryCalls = 0;
  const spool = await buildReplayableGcodeSpool('m4-metadata-test', () => {
    factoryCalls++;
    return (async function* (): AsyncGenerator<GcodeChunk> {
      yield {
        lines: ['G21', 'M4 S100', 'G1 X1 F600'],
        cumulativeLineCount: 3,
        isLast: true,
      };
    })();
  });

  assert.equal(spool.usesM4, true);
  assert.equal(factoryCalls, 1, 'M4 metadata is captured during spool construction');
});

test('LF-EXT-LGRBL-004: spool M4 metadata ignores comments', async () => {
  const spool = await buildReplayableGcodeSpool('m4-comment-metadata-test', () => {
    return (async function* (): AsyncGenerator<GcodeChunk> {
      yield {
        lines: ['G21', '; M4 note only', 'G0 X0', 'M3 S100', 'G1 X1 F600', 'M5'],
        cumulativeLineCount: 6,
        isLast: true,
      };
    })();
  });

  assert.equal(spool.usesM4, false, 'comment-only M4 does not mark the spool as dynamic-power output');
});

test('T3-40: materialized G-code export is explicitly memory-bounded', () => {
  assert.equal(MAX_MATERIALIZED_GCODE_LINES, 1_000_000);
  assert.equal(MAX_MATERIALIZED_GCODE_BYTES, 50 * 1024 * 1024);
  assert.doesNotThrow(() => assertMaterializedGcodeWithinLimit('G0 X0\nM5'));
  assert.throws(
    () => assertMaterializedGcodeWithinLimit('X'.repeat(MAX_MATERIALIZED_GCODE_BYTES + 1)),
    /too large for the current materialized pipeline/i,
  );
});

test.skip('T3-40/T2-17/T3-15: cancellation latency is measured inside million-line streaming', () => {
  // Current cancellation checkpoints exist in compile/plan/output loops, but
  // low-latency streaming cancellation needs the T3-15 sender/spool layer.
});
