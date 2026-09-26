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
});
