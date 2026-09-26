// The parity oracle's canonical hash must see every change a speed rewrite
// could make to a trace: order, a dropped curve, the last bit of a number, -0.
import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, traceImageToColoredPaths } from '../../core/trace';
import type { TraceOptions } from '../../core/trace';
import {
  canonicalTraceHash,
  canonicalTraceText,
  uniformNoiseImage,
  valueNoiseImage,
} from './trace-parity-oracle';
import { PERCEPTUAL_FIXTURES } from './shapes';

type Mutable = { color: string; polylines: unknown[]; curves?: unknown[] };

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe('trace parity canonical hash', () => {
  it('is independent of key order and skips undefined members', () => {
    const a = { color: '#000000', polylines: [], curves: undefined };
    const b = { polylines: [], color: '#000000' };
    expect(canonicalTraceHash([a])).toBe(canonicalTraceHash([b]));
    expect(canonicalTraceText([b])).toBe('[{"color":"#000000","polylines":[]}]');
  });

  it('distinguishes -0, the last bit of a double and typed-array contents', () => {
    expect(canonicalTraceHash([0])).not.toBe(canonicalTraceHash([-0]));
    expect(canonicalTraceHash([0.1 + 0.2])).not.toBe(canonicalTraceHash([0.3]));
    expect(canonicalTraceHash(new Float64Array([1, 2]))).not.toBe(
      canonicalTraceHash(new Float64Array([2, 1])),
    );
  });

  it('refuses a Map, Set, Date or class instance instead of hashing it as {}', () => {
    class Point {
      constructor(readonly x: number) {}
    }
    for (const opaque of [new Map([[1, 2]]), new Set([1]), new Date(0), new Point(1)]) {
      expect(() => canonicalTraceHash([{ color: '#000000', extra: opaque }])).toThrow(
        /only plain objects/,
      );
    }
    expect(canonicalTraceText([Object.assign(Object.create(null) as object, { a: 1 })])).toBe(
      '[{"a":1}]',
    );
  });

  it('changes when a real trace is reordered, loses a curve or moves one point', async () => {
    const disc = PERCEPTUAL_FIXTURES.find((fixture) => fixture.name === 'ring-annulus')!;
    const paths = (await traceImageToColoredPaths(
      disc.image,
      TRACE_PRESETS['Line Art'] as TraceOptions,
    )) as unknown as Mutable[];
    const hash = canonicalTraceHash(paths);
    expect(canonicalTraceHash(clone(paths))).toBe(hash);

    const withCurves = paths.findIndex((path) => (path.curves?.length ?? 0) > 0);
    expect(withCurves).toBeGreaterThanOrEqual(0);
    const dropped = clone(paths);
    dropped[withCurves]!.curves = dropped[withCurves]!.curves!.slice(1);
    expect(canonicalTraceHash(dropped)).not.toBe(hash);

    const polylines = paths.flatMap((path) => path.polylines);
    expect(polylines.length).toBeGreaterThanOrEqual(2);
    const reordered = clone(paths);
    const owner = reordered.find((path) => path.polylines.length >= 2);
    if (owner) owner.polylines.reverse();
    else reordered.reverse();
    expect(canonicalTraceHash(reordered)).not.toBe(hash);

    const nudged = clone(paths) as unknown as { polylines: { points: { x: number }[] }[] }[];
    const point = nudged[0]!.polylines[0]!.points[0]!;
    point.x = point.x + Math.abs(point.x) * Number.EPSILON + Number.MIN_VALUE;
    expect(canonicalTraceHash(nudged)).not.toBe(hash);
  });

  it('generates the seeded noise corpus deterministically', () => {
    expect(canonicalTraceHash(uniformNoiseImage(16, 192).data)).toBe(
      canonicalTraceHash(uniformNoiseImage(16, 192).data),
    );
    expect(canonicalTraceHash(valueNoiseImage(16, 3, 7).data)).not.toBe(
      canonicalTraceHash(valueNoiseImage(16, 3, 8).data),
    );
  });
});
