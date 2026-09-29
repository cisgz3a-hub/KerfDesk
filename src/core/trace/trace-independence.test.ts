// A trace must not depend on what the same process traced before (ADR-438
// amendment, speed wave 2). The long-lived trace worker runs many traces in
// one module instance, and every bit-identity gate assumes a trace's output
// and its topology-repair work are functions of its own input alone.
import { describe, expect, it, vi } from 'vitest';
import {
  canonicalTraceHash,
  uniformNoiseImage,
} from '../../__fixtures__/perceptual/trace-parity-oracle';
import { PERCEPTUAL_FIXTURES } from '../../__fixtures__/perceptual/shapes';
import type { RawImageData } from './trace-image';
import type { TraceStepRunner, TraceSteps } from './trace-steps';
import type * as ContourIntersections from './contour-intersections';
import type * as TraceModule from './index';
import type { TraceOptions } from './index';

// Conflicts found by each topology-repair round, as the repair loop sees them.
const rounds: number[][] = [];
vi.mock('./contour-intersections', async (importOriginal) => {
  const original = await importOriginal<typeof ContourIntersections>();
  return {
    ...original,
    intersectingContourLoopsSteps: function* (
      ...args: Parameters<typeof original.intersectingContourLoopsSteps>
    ) {
      const conflicts = yield* original.intersectingContourLoopsSteps(...args);
      rounds[rounds.length - 1]?.push(conflicts.size);
      return conflicts;
    },
  };
});

type Trace = { readonly hash: string; readonly rounds: ReadonlyArray<number> };

async function freshTracer(): Promise<typeof TraceModule> {
  vi.resetModules();
  return import('./index');
}

async function traceWith(
  tracer: typeof TraceModule,
  image: RawImageData,
  preset: string,
): Promise<Trace> {
  rounds.push([]);
  const paths = await tracer.traceImageToColoredPaths(
    image,
    tracer.TRACE_PRESETS[preset] as TraceOptions,
  );
  return { hash: canonicalTraceHash(paths), rounds: rounds[rounds.length - 1]! };
}

const target = uniformNoiseImage(96, 192);
// Photo shading and Centerline never run the contour topology repair, so for
// them only the output hash is compared.
const REPAIRING_PRESETS = new Set(['Line Art', 'Edge Detection', 'Smooth', 'Sharp']);
const ring = PERCEPTUAL_FIXTURES.find((fixture) => fixture.name === 'ring-annulus')!.image;

describe('trace independence', () => {
  it.each(['Line Art', 'Photo shading', 'Centerline', 'Edge Detection', 'Smooth', 'Sharp'])(
    '%s: a trace after other traces equals the same trace in a fresh module instance',
    async (preset) => {
      const fresh = await traceWith(await freshTracer(), target, preset);
      expect(fresh.rounds.length > 0).toBe(REPAIRING_PRESETS.has(preset));

      const tracer = await freshTracer();
      await traceWith(tracer, uniformNoiseImage(80, 7), 'Sharp');
      await traceWith(tracer, ring, 'Centerline');
      await traceWith(tracer, uniformNoiseImage(72, 11), 'Smooth');
      const after = await traceWith(tracer, target, preset);
      const again = await traceWith(tracer, target, preset);

      expect(after).toEqual(fresh);
      expect(again).toEqual(fresh);
    },
    120_000,
  );

  // The UI's inline runner steps a trace cooperatively (next(true)) between
  // tasks, so two traces can interleave and a superseded one is dropped
  // mid-way. Neither may leak into another trace.
  it('interleaved cooperative traces and a trace abandoned mid-way leave every trace equal to a fresh one', async () => {
    const cases = [
      { image: target, preset: 'Line Art' },
      { image: ring, preset: 'Centerline' },
      { image: uniformNoiseImage(80, 7), preset: 'Sharp' },
    ] as const;
    const fresh: string[] = [];
    const stepCounts: number[] = [];
    for (const { image, preset } of cases) {
      const tracer = await freshTracer();
      const counted = cooperative('count');
      fresh.push(await hashWith(tracer, image, preset, counted.runner));
      stepCounts.push(counted.steps());
    }

    const tracer = await freshTracer();
    // Abandon the Sharp and Centerline traces half way through their steps.
    for (const k of [2, 1]) {
      const { image, preset } = cases[k]!;
      const abandoned = cooperative('drop', Math.floor(stepCounts[k]! / 2));
      await expect(hashWith(tracer, image, preset, abandoned.runner)).rejects.toThrow(/abandoned/);
    }
    // Step the Line Art and Centerline traces alternately.
    const log: string[] = [];
    const a = cooperative('a', Infinity, log);
    const b = cooperative('b', Infinity, log);
    const [lineArt, centerline] = await Promise.all([
      hashWith(tracer, cases[0].image, cases[0].preset, a.runner),
      hashWith(tracer, cases[1].image, cases[1].preset, b.runner),
    ]);
    expect(log.join('')).toMatch(/ab.*ba|ba.*ab/);
    expect([lineArt, centerline]).toEqual([fresh[0], fresh[1]]);
    for (const [k, { image, preset }] of cases.entries()) {
      expect(await hashWith(tracer, image, preset)).toBe(fresh[k]);
    }
  }, 240_000);
});

async function hashWith(
  tracer: typeof TraceModule,
  image: RawImageData,
  preset: string,
  runner?: TraceStepRunner,
): Promise<string> {
  rounds.push([]);
  const options = tracer.TRACE_PRESETS[preset] as TraceOptions;
  return canonicalTraceHash(await tracer.traceImageToColoredPaths(image, options, runner));
}

// A cooperative runner: next(true) per step with a microtask between steps,
// so concurrent traces alternate. After `budget` steps it drops the trace.
function cooperative(
  tag: string,
  budget = Infinity,
  log?: string[],
): { readonly runner: TraceStepRunner; readonly steps: () => number } {
  let taken = 0;
  async function drive<T>(steps: TraceSteps<T>): Promise<T> {
    for (;;) {
      const step = steps.next(true);
      if (step.done) return step.value;
      taken += 1;
      log?.push(tag);
      if (taken >= budget) throw new Error(`${tag}: trace abandoned`);
      await Promise.resolve();
    }
  }
  return { runner: drive, steps: () => taken };
}
