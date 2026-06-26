import { describe, expect, it } from 'vitest';
import {
  auditTraceBenchmarkResults,
  buildNoisyPhotoControlsBenchmark,
  runCurrentTraceBenchmarks,
  runTraceBenchmarkLoop,
  type TraceBenchmarkResult,
} from './trace-benchmark-loop';

describe('trace benchmark loop', () => {
  it('rates current trace artifacts against explicit 10/10 benchmarks', async () => {
    const audit = auditTraceBenchmarkResults(await runCurrentTraceBenchmarks(), { goalRating: 10 });

    expect(audit.passed).toBe(true);
    expect(audit.rating).toBe(10);
    expect(audit.fixPrompt).toBeNull();
    expect(audit.findings).toEqual([]);
    expect(audit.results.map((result) => result.id)).toEqual([
      'edge-square-canny-quality',
      'edge-noisy-photo-controls',
      'edge-segmented-curve-linking',
      'arch-house-edge-curve-cleanup',
      'centerline-landed-regression',
      'arch-house-line-art-baseline',
    ]);
  });

  it('keeps curve linking, real Edge Detection, Centerline, and Line Art in the benchmark loop', async () => {
    const results = await runCurrentTraceBenchmarks();
    const curveLinking = requiredResult(results, 'edge-segmented-curve-linking');
    const archHouseEdge = requiredResult(results, 'arch-house-edge-curve-cleanup');
    const centerline = requiredResult(results, 'centerline-landed-regression');
    const archHouse = requiredResult(results, 'arch-house-line-art-baseline');

    expect(curveLinking.findings).toEqual([]);
    expect(curveLinking.metrics.strokePolylineCount).toBeLessThanOrEqual(4);
    expect(curveLinking.metrics.longestStrokeAngularCoverageRatio).toBeGreaterThanOrEqual(0.9);
    expect(curveLinking.metrics.maxLongestStrokeAngularGapDeg).toBeLessThanOrEqual(30);

    expect(archHouseEdge.findings).toEqual([]);
    expect(archHouseEdge.metrics.smallClosedPolylineCount).toBeLessThanOrEqual(4);
    expect(archHouseEdge.metrics.shortArchPolylineCount).toBeLessThanOrEqual(2);
    expect(archHouseEdge.metrics.aggregateArchCoverageRatio).toBeGreaterThanOrEqual(0.95);

    expect(centerline.findings).toEqual([]);
    expect(centerline.metrics.maxDeviationPx).toBeLessThanOrEqual(1.6);
    expect(centerline.metrics.maxGapPx).toBeLessThanOrEqual(3.5);
    expect(centerline.metrics.shortFragmentCount).toBe(0);

    expect(archHouse.findings).toEqual([]);
    expect(archHouse.metrics.openPolylineCount).toBe(0);
    expect(archHouse.metrics.bottomWordInk).toBeGreaterThanOrEqual(3000);
    expect(archHouse.metrics.pointCount).toBeGreaterThan(500);
    expect(archHouse.metrics.pointCount).toBeLessThan(80_000);
  });

  it('generates a concrete fix prompt when benchmark findings keep the rating below goal', () => {
    const audit = auditTraceBenchmarkResults([failingBenchmarkResult()], { goalRating: 10 });

    expect(audit.passed).toBe(false);
    expect(audit.rating).toBe(6);
    expect(audit.fixPrompt).toContain('Fix the trace benchmark failures');
    expect(audit.fixPrompt).toContain('edge-noisy-photo-controls');
    expect(audit.fixPrompt).toContain('strayPointCount');
    expect(audit.fixPrompt).toContain('actual 240');
    expect(audit.fixPrompt).toContain('target <= 120');
  });

  it('treats the noisy-photo stray-point target as an inclusive upper bound', () => {
    const result = buildNoisyPhotoControlsBenchmark(
      { pointCount: 200, totalPolylineLength: 300, strayPointCount: 100, coverageRatio: 1 },
      { pointCount: 120, totalPolylineLength: 180, strayPointCount: 50, coverageRatio: 0.9 },
    );

    expect(result.benchmark.strayPointCount).toBe('<= 50');
    expect(result.findings).toEqual([]);
    expect(result.rating).toBe(10);
  });

  it('reruns audit/fix iterations until the benchmark reaches the goal', async () => {
    let iteration = 0;
    const loop = await runTraceBenchmarkLoop({
      goalRating: 10,
      maxIterations: 3,
      runBenchmarks: () => {
        iteration += 1;
        return iteration === 1 ? [failingBenchmarkResult()] : [passingBenchmarkResult()];
      },
      applyFixPrompt: (prompt) => {
        expect(prompt).toContain('edge-noisy-photo-controls');
      },
    });

    expect(loop.status).toBe('passed');
    expect(loop.iterations).toHaveLength(2);
    expect(loop.iterations[0]?.passed).toBe(false);
    expect(loop.iterations[1]?.passed).toBe(true);
  });

  it('stops with the next fix prompt when no fix applicator is provided', async () => {
    const loop = await runTraceBenchmarkLoop({
      goalRating: 10,
      maxIterations: 3,
      runBenchmarks: () => [failingBenchmarkResult()],
    });

    expect(loop.status).toBe('needs-fix');
    expect(loop.iterations).toHaveLength(1);
    expect(loop.fixPrompt).toContain('Fix the trace benchmark failures');
  });
});

function requiredResult(
  results: ReadonlyArray<TraceBenchmarkResult>,
  id: string,
): TraceBenchmarkResult {
  const result = results.find((item) => item.id === id);
  if (result === undefined) throw new Error(`Missing benchmark result: ${id}`);
  return result;
}

function failingBenchmarkResult(): TraceBenchmarkResult {
  return {
    id: 'edge-noisy-photo-controls',
    name: 'Noisy photo-like Edge Detection controls',
    rating: 6,
    metrics: {
      coverageRatio: 0.8,
      strayPointCount: 240,
    },
    benchmark: {
      coverageRatio: '>= 0.75',
      strayPointCount: '<= 120',
    },
    findings: [
      {
        severity: 'high',
        metric: 'strayPointCount',
        actual: 240,
        target: '<= 120',
        message: 'Restrained Edge Detection still emits too many texture/noise vector points.',
        fixHint:
          'Tune edge-specific linking, minimum line filtering, or texture suppression before changing UI labels.',
      },
    ],
  };
}

function passingBenchmarkResult(): TraceBenchmarkResult {
  return {
    ...failingBenchmarkResult(),
    rating: 10,
    metrics: {
      coverageRatio: 0.91,
      strayPointCount: 80,
    },
    findings: [],
  };
}
