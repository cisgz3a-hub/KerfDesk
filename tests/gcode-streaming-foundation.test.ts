/**
 * T3-15: pin the streaming G-code output API foundation.
 *
 * Run: npx tsx tests/gcode-streaming-foundation.test.ts
 */

import {
  chunkArrayBy,
  collectStreamingOutput,
  fromArray,
  isStreamingOutputStrategy,
  type GcodeChunk,
  type StreamingOutputStrategy,
} from '../src/core/output/GcodeStreaming';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== T3-15 G-code streaming foundation ===\n');

void (async () => {
  // 1. chunkArrayBy: even split.
  {
    const lines = ['a', 'b', 'c', 'd', 'e', 'f'];
    const chunks = chunkArrayBy(lines, 2);
    assert(chunks.length === 3, 'chunkArrayBy(6 lines, 2): 3 chunks');
    assert(chunks[0]?.lines.length === 2, 'Chunk 0: 2 lines');
    assert(chunks[0]?.cumulativeLineCount === 2, 'Chunk 0: cumulative 2');
    assert(chunks[0]?.isLast === false, 'Chunk 0: not last');
    assert(chunks[2]?.isLast === true, 'Chunk 2: last');
    assert(chunks[2]?.cumulativeLineCount === 6, 'Chunk 2: cumulative 6 (total)');
  }

  // 2. chunkArrayBy: uneven split puts the remainder in the last chunk.
  {
    const lines = ['a', 'b', 'c', 'd', 'e'];
    const chunks = chunkArrayBy(lines, 2);
    assert(chunks.length === 3, 'chunkArrayBy(5 lines, 2): 3 chunks');
    assert(chunks[2]?.lines.length === 1, 'Chunk 2 (uneven): 1 line');
    assert(chunks[2]?.isLast === true, 'Chunk 2 (uneven): last');
  }

  // 3. chunkArrayBy: empty input yields a single empty terminal chunk.
  {
    const chunks = chunkArrayBy([], 100);
    assert(chunks.length === 1, 'chunkArrayBy([]): 1 terminal chunk');
    assert(chunks[0]?.lines.length === 0, 'Empty terminal chunk: no lines');
    assert(chunks[0]?.cumulativeLineCount === 0, 'Empty terminal chunk: cumulative 0');
    assert(chunks[0]?.isLast === true, 'Empty terminal chunk: last');
  }

  // 4. chunkArrayBy: chunk size larger than input yields one chunk.
  {
    const chunks = chunkArrayBy(['a', 'b'], 100);
    assert(chunks.length === 1, 'Chunk size > input: 1 chunk');
    assert(chunks[0]?.isLast === true, 'Single chunk is last');
    assert(chunks[0]?.lines.length === 2, 'Single chunk has all 2 lines');
  }

  // 5. chunkArrayBy: invalid chunkLines throws.
  {
    let threw = false;
    try { chunkArrayBy(['a'], 0); } catch { threw = true; }
    assert(threw, 'chunkArrayBy: chunkLines=0 throws');

    threw = false;
    try { chunkArrayBy(['a'], -1); } catch { threw = true; }
    assert(threw, 'chunkArrayBy: chunkLines<0 throws');
  }

  // 6. fromArray: yields the same shape as chunkArrayBy.
  {
    const lines = ['a', 'b', 'c', 'd'];
    const collected: GcodeChunk[] = [];
    for await (const chunk of fromArray(lines, { chunkLines: 2 })) {
      collected.push(chunk);
    }
    assert(collected.length === 2, 'fromArray(4 lines, chunkLines=2): 2 chunks');
    assert(collected[1]?.isLast === true, 'fromArray: last chunk flagged');
  }

  // 7. fromArray: default chunk size is 1000.
  {
    const lines: string[] = [];
    for (let i = 0; i < 1500; i++) lines.push(`G1 X${i}`);
    const chunks: GcodeChunk[] = [];
    for await (const chunk of fromArray(lines)) chunks.push(chunk);
    assert(chunks.length === 2, 'fromArray default: 1500 lines → 2 chunks at default size');
    assert(chunks[0]?.lines.length === 1000, 'fromArray default: first chunk size 1000');
    assert(chunks[1]?.lines.length === 500, 'fromArray default: second chunk size 500 (remainder)');
  }

  // 8. fromArray: pre-aborted signal yields nothing.
  {
    const ac = new AbortController();
    ac.abort();
    const collected: GcodeChunk[] = [];
    for await (const chunk of fromArray(['a', 'b', 'c'], { signal: ac.signal })) {
      collected.push(chunk);
    }
    assert(collected.length === 0, 'fromArray: pre-aborted signal yields nothing');
  }

  // 9. collectStreamingOutput: drains a streaming source into a flat
  //    array + summary.
  {
    const lines = ['G1 X0', 'G1 X10', 'M5'];
    const result = await collectStreamingOutput(fromArray(lines, { chunkLines: 2 }));
    assert(result.lines.length === 3, 'collect: lines count matches');
    assert(result.lineCount === 3, 'collect: lineCount matches');
    assert(result.sawLast === true, 'collect: sawLast=true after iteration');
    assert(result.lines.join(',') === lines.join(','), 'collect: lines order preserved');
  }

  // 10. collectStreamingOutput: cancellation via signal returns
  //     partial output without throwing.
  {
    const ac = new AbortController();
    let count = 0;
    async function* slow(): AsyncGenerator<GcodeChunk, void, void> {
      yield { lines: ['a'], cumulativeLineCount: 1, isLast: false };
      count++;
      ac.abort();
      yield { lines: ['b'], cumulativeLineCount: 2, isLast: true };
    }
    const result = await collectStreamingOutput(slow(), ac.signal);
    assert(result.lines.length === 1, 'cancellation: only the pre-abort chunk collected');
    assert(result.sawLast === false, 'cancellation: sawLast=false (terminal chunk skipped)');
    assert(count === 1, 'cancellation: producer ran once before abort');
  }

  // 11. isStreamingOutputStrategy predicate: positive case.
  {
    const strategy: StreamingOutputStrategy = {
      format: 'grbl',
      generateGcode(): AsyncIterable<GcodeChunk> {
        return fromArray([]);
      },
    };
    assert(isStreamingOutputStrategy(strategy), 'predicate: real strategy true');
  }

  // 12. isStreamingOutputStrategy predicate: negative cases.
  {
    assert(!isStreamingOutputStrategy(null), 'predicate: null → false');
    assert(!isStreamingOutputStrategy(undefined), 'predicate: undefined → false');
    assert(!isStreamingOutputStrategy({}), 'predicate: empty object → false');
    assert(!isStreamingOutputStrategy({ format: 'grbl' }), 'predicate: missing generateGcode → false');
    assert(!isStreamingOutputStrategy({ generateGcode: () => fromArray([]) }), 'predicate: missing format → false');
    assert(!isStreamingOutputStrategy({ format: 42, generateGcode: () => fromArray([]) }), 'predicate: non-string format → false');
  }

  // 13. End-to-end: a 50,000-line "synthetic large job" round-trips
  //     through fromArray + collectStreamingOutput without exhausting
  //     memory. Smoke-tests the contract; not a real perf test.
  {
    const lines: string[] = [];
    for (let i = 0; i < 50_000; i++) lines.push(`G1 X${(i * 0.1).toFixed(2)}`);
    const result = await collectStreamingOutput(fromArray(lines, { chunkLines: 1000 }));
    assert(result.lineCount === 50_000, 'Large job round-trip: 50,000 lines preserved');
    assert(result.sawLast === true, 'Large job round-trip: terminal chunk reached');
  }

  // 14. Source pin: T3-15 marker + module decoupling.
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const moduleSrc = fs.readFileSync(
      path.resolve(here, '../src/core/output/GcodeStreaming.ts'),
      'utf-8',
    );

    assert(/T3-15/.test(moduleSrc), 'Source: T3-15 marker present');
    assert(
      !/from\s+['"][^'"]*\/GrblController['"]/.test(moduleSrc),
      'Source: GcodeStreaming does not import GrblController (decoupled)',
    );
    assert(
      !/from\s+['"][^'"]*\/PipelineService['"]/.test(moduleSrc),
      'Source: GcodeStreaming does not import PipelineService (decoupled)',
    );
    assert(
      /import\s+type\s+\{\s*Job\s*\}/.test(moduleSrc),
      'Source: Job imported as type-only',
    );
    assert(
      /import\s+type\s+\{\s*Plan\s*\}/.test(moduleSrc),
      'Source: Plan imported as type-only',
    );
  }

  console.log(`\nT3-15 streaming foundation: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
