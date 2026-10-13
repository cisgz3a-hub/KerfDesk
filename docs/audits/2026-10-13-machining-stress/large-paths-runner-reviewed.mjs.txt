// Deterministic software-only route stress. No controllers or hardware are used.
// One isolated worker per fixture bounds pathological planner CPU and memory.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

const seeds = [17, 491, 20261013];
const patterns = ['grid', 'cluster', 'coincident', 'nested'];
const directions = ['preserve', 'allow-reverse'];
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

if (isMainThread) await main();
else await runFixture();

async function main() {
  const args = process.argv.slice(2);
  const diagnostic = args.includes('--diagnose-coincident');
  const sizes = diagnostic ? [50000] : args.includes('--smoke') ? [64] : [1000, 10000, 50000];
  const selectedSeeds = diagnostic ? [17] : seeds;
  const selectedPatterns = diagnostic ? ['coincident'] : patterns;
  const selectedDirections = diagnostic ? ['preserve'] : directions;
  const timeoutMs = Number(
    args.find((arg) => arg.startsWith('--timeout-ms='))?.split('=')[1] ?? 30000,
  );
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 300000);
  const results = [];
  console.log(
    JSON.stringify({
      event: 'configuration',
      sizes,
      seeds: selectedSeeds,
      patterns: selectedPatterns,
      directions: selectedDirections,
      mode: diagnostic ? 'single-call-diagnostic' : 'stress-with-repeat',
      timeoutMs,
      timeoutScope:
        'Whole fixture worker: setup, generation, selected calls and checks, cleanup. Diagnostic mode omits repeat and greedy oracle.',
      elapsedScope: 'elapsedMs and repeatMs each measure only one optimizePaths call.',
      heapScope:
        'Worker heap snapshots immediately before and after first call; not peak memory, no forced GC.',
      memoryLimitScope: '768 MiB worker V8 old generation; not a total process RSS limit.',
      qualification:
        'Software geometry invariants only. Elapsed time, heap and travel are observations, not machine runtime or quality proof.',
    }),
  );
  for (const count of sizes) {
    for (const seed of selectedSeeds) {
      for (const pattern of selectedPatterns) {
        const fixture = { count, seed, pattern, diagnostic };
        const result = await isolatedFixture(fixture, timeoutMs);
        results.push(result);
        console.log(JSON.stringify({ event: 'fixture-complete', ...fixture, ...result }));
      }
    }
  }
  const summary = {
    event: 'summary',
    fixtures: results.length,
    passedFixtures: results.filter((result) => result.status === 'passed').length,
    failedFixtures: results.filter((result) => result.status === 'failed').length,
    timedOutFixtures: results.filter((result) => result.status === 'timeout').length,
    passedRouteCases: results.reduce(
      (sum, result) => sum + result.metrics.filter((metric) => !metric.diagnostic).length,
      0,
    ),
    passedDiagnosticCases: results.reduce(
      (sum, result) => sum + result.metrics.filter((metric) => metric.diagnostic).length,
      0,
    ),
  };
  console.log(JSON.stringify(summary));
  if (summary.failedFixtures > 0 || summary.timedOutFixtures > 0) process.exitCode = 1;
}

function isolatedFixture(fixture, timeoutMs) {
  return new Promise((resolve) => {
    const metrics = [];
    const worker = new Worker(new URL(import.meta.url), {
      workerData: fixture,
      resourceLimits: { maxOldGenerationSizeMb: 768 },
    });
    let settled = false;
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await worker.terminate();
      resolve({ ...result, metrics });
    };
    const timer = setTimeout(
      () =>
        finish({
          status: 'timeout',
          limitMs: timeoutMs,
          limitScope: 'Whole fixture worker, including setup, selected calls and verification.',
          incompleteDirections: (fixture.diagnostic ? ['preserve'] : directions).filter(
            (direction) => !metrics.some((item) => item.direction === direction),
          ),
        }),
      timeoutMs,
    );
    worker.on('message', (message) => {
      if (message.event === 'metric') {
        metrics.push(message.metric);
        console.log(JSON.stringify({ event: 'route-case', ...fixture, ...message.metric }));
      } else if (message.event === 'diagnostic-stage') {
        console.log(JSON.stringify({ ...message, ...fixture }));
      } else if (message.event === 'done') void finish({ status: 'passed' });
    });
    worker.on('error', (error) => {
      void finish({ status: 'failed', error: error.stack });
    });
    worker.on('exit', (code) => {
      if (!settled)
        void finish({ status: 'failed', error: `Worker exited ${code} before completion` });
    });
  });
}

async function runFixture() {
  const workerBegan = performance.now();
  const { createServer } = await import('vite');
  let server;
  try {
    server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      appType: 'custom',
      server: { middlewareMode: true, hmr: false, ws: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    const { optimizePaths } = await server.ssrLoadModule(
      join(root, 'src/core/job/optimize-paths.ts'),
    );
    const { count, pattern, seed } = workerData;
    const segments = makeSegments(count, pattern, seed);
    const group = {
      kind: 'cut',
      layerId: 'stress',
      color: '#000000',
      power: 50,
      speed: 1200,
      passes: 1,
      airAssist: false,
      segments,
    };
    const job = deepFreeze({ groups: [group] });
    const before = fingerprint(job);
    for (const direction of workerData.diagnostic ? ['preserve'] : directions) {
      const settings = {
        travelPolicy: 'nearest-neighbor',
        insideFirst: true,
        layerPriority: 'project-order',
        pathDirection: direction,
        startPoint: 'machine-origin',
        closedShapeStart: 'drawn',
      };
      const heapBefore = process.memoryUsage().heapUsed;
      const began = performance.now();
      if (workerData.diagnostic)
        parentPort.postMessage({
          event: 'diagnostic-stage',
          stage: 'optimizer-starting',
          setupMs: began - workerBegan,
        });
      const result = optimizePaths(job, settings);
      const elapsedMs = performance.now() - began;
      const heapAfter = process.memoryUsage().heapUsed;
      if (workerData.diagnostic)
        parentPort.postMessage({
          event: 'diagnostic-stage',
          stage: 'optimizer-returned',
          elapsedMs,
        });
      assert.equal(fingerprint(job), before, 'Input mutated');
      assert.equal(result.groups.length, 1, 'Optimizer added or removed a group');
      verifyGeometry(group, result.groups[0], direction);
      if (pattern === 'nested') verifyNestedOrder(result.groups[0].segments);
      if (workerData.diagnostic) {
        parentPort.postMessage({
          event: 'metric',
          metric: {
            diagnostic: true,
            direction,
            elapsedMs,
            heapBeforeBytes: heapBefore,
            heapAfterBytes: heapAfter,
            heapDeltaBytes: heapAfter - heapBefore,
            segments: result.groups[0].segments.length,
            travelMm: routeTravel(result.groups[0].segments),
            geometryPreserved: true,
            immutableInput: true,
            groupCount: result.groups.length,
            deterministic: 'not checked in single-call diagnostic',
            independentGreedyOraclePaths: 0,
          },
        });
        continue;
      }
      const expectedFingerprint = fingerprint(result);
      const repeatBegan = performance.now();
      const repeat = optimizePaths(job, settings);
      const repeatMs = performance.now() - repeatBegan;
      assert.equal(repeat.groups.length, 1, 'Repeated optimizer added or removed a group');
      assert.equal(fingerprint(repeat), expectedFingerprint, 'Non-deterministic repeated route');
      assert.equal(fingerprint(job), before, 'Repeat mutated input');
      // The oracle scans every remaining endpoint itself. It does not use the
      // production entry grid, containment code, distance helper or reversal.
      const oracleSample = makeSegments(48, pattern === 'nested' ? 'grid' : pattern, seed);
      const oracleResult = optimizePaths(
        { groups: [{ ...group, segments: oracleSample }] },
        settings,
      );
      assert.deepEqual(oracleResult.groups[0].segments, exhaustiveGreedy(oracleSample, direction));
      const travelMm = routeTravel(result.groups[0].segments);
      assert.ok(Number.isFinite(travelMm));
      parentPort.postMessage({
        event: 'metric',
        metric: {
          direction,
          elapsedMs,
          repeatMs,
          heapBeforeBytes: heapBefore,
          heapAfterBytes: heapAfter,
          heapDeltaBytes: heapAfter - heapBefore,
          travelMm,
          segments: result.groups[0].segments.length,
          geometryPreserved: true,
          immutableInput: true,
          deterministic: true,
          independentGreedyOraclePaths: oracleSample.length,
          nestedPrecedenceChecked: pattern === 'nested',
        },
      });
    }
  } finally {
    await server?.close();
  }
  parentPort.postMessage({ event: 'done' });
}

function makeSegments(count, pattern, seed) {
  const random = generator(seed);
  const segments = [];
  const side = Math.ceil(Math.sqrt(count));
  for (let id = 0; id < count; id++) {
    let points;
    if (pattern === 'nested') {
      const family = Math.floor(id / 4);
      const depth = id % 4;
      const x = (family % side) * 20 + depth;
      const y = Math.floor(family / side) * 20 + depth;
      const edge = 12 - 2 * depth;
      points = [
        [x, y],
        [x + edge, y],
        [x + edge, y + edge],
        [x, y + edge],
        [x, y],
      ];
    } else {
      let x = (id % side) * 3;
      let y = Math.floor(id / side) * 3;
      if (pattern === 'cluster') {
        x = (id % 4) * 100 + random() * 3;
        y = (Math.floor(id / 4) % 4) * 100 + random() * 3;
      } else if (pattern === 'coincident') {
        x = 40;
        y = 40;
      }
      points = [
        [x, y],
        [x + 0.25, y + 0.125],
        [x + 0.5, y],
      ];
      if (random() < 0.5) points.reverse();
    }
    segments.push({
      stressId: id,
      closed: pattern === 'nested',
      polyline: points.map(([x, y]) => ({ x, y })),
    });
  }
  // Deliberately unrelated source order, reproducible for every size and seed.
  for (let index = segments.length - 1; index > 0; index--) {
    const pick = Math.floor(random() * (index + 1));
    [segments[index], segments[pick]] = [segments[pick], segments[index]];
  }
  return segments;
}

function verifyGeometry(source, result, direction) {
  assert.deepEqual({ ...source, segments: [] }, { ...result, segments: [] });
  assert.equal(result.segments.length, source.segments.length);
  const byId = new Map(source.segments.map((segment) => [segment.stressId, segment]));
  const seen = new Set();
  for (const segment of result.segments) {
    assert.ok(!seen.has(segment.stressId), 'Duplicated segment');
    seen.add(segment.stressId);
    const original = byId.get(segment.stressId);
    assert.ok(original, 'Invented segment');
    assert.equal(segment.closed, original.closed);
    for (const point of segment.polyline)
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    const forward = JSON.stringify(original.polyline);
    const actual = JSON.stringify(segment.polyline);
    const backward = JSON.stringify([...original.polyline].reverse());
    assert.ok(
      actual === forward ||
        (direction === 'allow-reverse' && !segment.closed && actual === backward),
      'Altered geometry or forbidden reversal',
    );
  }
  assert.equal(seen.size, byId.size, 'Lost segment');
}

function verifyNestedOrder(segments) {
  const position = new Map(segments.map((segment, index) => [segment.stressId, index]));
  for (const segment of segments) {
    // Construction is analytically four strictly nested squares, separated
    // from every other family. No production containment predicate is reused.
    if (segment.stressId % 4 !== 0) {
      assert.ok(
        position.get(segment.stressId) < position.get(segment.stressId - 1),
        'Parent cut before its contained child',
      );
    }
  }
}

function exhaustiveGreedy(segments, direction) {
  const remaining = new Set(segments.map((_, index) => index));
  const result = [];
  let cursor = { x: 0, y: 0 };
  while (remaining.size > 0) {
    let best;
    let bestDistance = Infinity;
    for (const index of remaining) {
      const segment = segments[index];
      for (const reverse of direction === 'allow-reverse' ? [false, true] : [false]) {
        const point = reverse ? segment.polyline.at(-1) : segment.polyline[0];
        const distance = (point.x - cursor.x) ** 2 + (point.y - cursor.y) ** 2;
        // Ascending original indices, forward before reverse, is the stated
        // deterministic tie contract; strict improvement retains the first.
        if (distance < bestDistance) {
          best = { index, reverse };
          bestDistance = distance;
        }
      }
    }
    const original = segments[best.index];
    const next = best.reverse
      ? { ...original, polyline: [...original.polyline].reverse() }
      : original;
    result.push(next);
    remaining.delete(best.index);
    cursor = next.polyline.at(-1);
  }
  return result;
}

function routeTravel(segments) {
  let cursor = { x: 0, y: 0 };
  let distance = 0;
  for (const segment of segments) {
    const first = segment.polyline[0];
    distance += Math.hypot(first.x - cursor.x, first.y - cursor.y);
    cursor = segment.polyline.at(-1);
  }
  return distance + Math.hypot(cursor.x, cursor.y);
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
