import { expect, it } from 'vitest';
import { TRACE_PRESETS } from '../../core/trace';
import type { ColoredPath } from '../../core/scene';
import type { TracePreparationRequest } from './prepared-trace';
import { TracePreviewCache } from './trace-preview-cache';
import type { TracePreviewState } from './use-trace-preview';

const file = new File(['pixels'], 'source.png');
const base: TracePreparationRequest = {
  file,
  options: TRACE_PRESETS.Sharp!,
  boundary: null,
  boundaryMode: 'crop',
  sourceGrid: { width: 200, height: 100 },
};
function request(gamma: number): TracePreparationRequest {
  return { ...base, options: { ...base.options, gamma } };
}
function ready(
  request: TracePreparationRequest,
  paths: ColoredPath[] = [],
  svg = '<svg/>',
): Extract<TracePreviewState, { kind: 'ready' }> {
  const result = {
    paths,
    bounds: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
    width: 200,
    height: 100,
  };
  return { kind: 'ready', ...result, svg, preparedTrace: { request, result } };
}

it('evicts the least recently visited result and rebinds a hit to current request identity', () => {
  const cache = new TracePreviewCache(file, { maxEntries: 2 });
  const a = request(1),
    b = request(2),
    c = request(3);
  const first = ready(a);
  cache.remember(a, first);
  cache.remember(b, ready(b));
  const fresh = request(1);
  const hit = cache.get(fresh);
  expect(hit?.preparedTrace?.request).toBe(fresh);
  expect(hit?.preparedTrace?.result).toBe(first.preparedTrace?.result);
  cache.remember(c, ready(c));
  expect(cache.get(b)).toBeUndefined();
  expect(cache.get(a)?.paths).toBe(first.paths);
  expect(cache.get(c)?.kind).toBe('ready');
});

it('counts SVG text against the byte budget without evicting a useful result for an oversized one', () => {
  const cache = new TracePreviewCache(file, { maxBytes: 5000 });
  cache.remember(base, ready(base));
  const large = request(2);
  cache.remember(large, ready(large, [], 'x'.repeat(2500)));
  expect(cache.get(large)).toBeUndefined();
  expect(cache.get(base)).toBeDefined();
});

it.each(['points', 'curves'] as const)('includes retained %s in the byte budget', (kind) => {
  const cache = new TracePreviewCache(file, { maxBytes: 5000 });
  const point = { x: 1, y: 2 };
  const path: ColoredPath =
    kind === 'points'
      ? {
          color: '#000',
          polylines: [{ closed: false, points: Array.from({ length: 150 }, () => point) }],
        }
      : {
          color: '#000',
          polylines: [],
          curves: [
            {
              start: point,
              closed: false,
              segments: Array.from({ length: 100 }, () => ({ kind: 'line' as const, to: point })),
            },
          ],
        };
  cache.remember(base, ready(base, [path]));
  expect(cache.get(base)).toBeUndefined();
});

it('accounts for cubic control points and evicts by combined retained bytes', () => {
  const cache = new TracePreviewCache(file, { maxBytes: 5000 });
  const point = { x: 1, y: 2 };
  const cubic: ColoredPath = {
    color: '#000',
    polylines: [],
    curves: [
      {
        start: point,
        closed: false,
        segments: Array.from({ length: 20 }, () => ({
          kind: 'cubic' as const,
          to: point,
          control1: { x: 2, y: 3 },
          control2: { x: 4, y: 5 },
        })),
      },
    ],
  };
  cache.remember(base, ready(base, [cubic]));
  expect(cache.get(base)).toBeUndefined();
  cache.remember(base, ready(base, [], 'x'.repeat(1000)));
  expect(cache.get(base)).toBeDefined();
  const second = request(2);
  cache.remember(second, ready(second, [], 'x'.repeat(1000)));
  expect(cache.get(second)).toBeDefined();
  expect(cache.get(base)).toBeUndefined();
});

it('matches option and boundary values independently of object property order', () => {
  const original = { ...base, boundary: { x: 1, y: 2, width: 10, height: 20 } };
  const cache = new TracePreviewCache(file);
  cache.remember(original, ready(original));
  const reordered = {
    ...base,
    options: Object.fromEntries(Object.entries(base.options).reverse()) as typeof base.options,
    boundary: { height: 20, width: 10, y: 2, x: 1 },
  };
  expect(cache.get(reordered)).toBeDefined();
  for (const modified of [
    { ...original, options: { ...original.options, gamma: 1.2 } },
    { ...original, options: { ...original.options, traceTransparency: true } },
    { ...original, options: { ...original.options, fixedPalette: ['#000000', '#ffffff'] } },
    { ...original, boundary: { ...original.boundary, x: 2 } },
    { ...original, boundaryMode: 'enhance' as const },
    { ...original, sourceGrid: { width: 199, height: 100 } },
  ])
    expect(cache.get(modified)).toBeUndefined();
});

it('keeps valid empty output, scopes by File identity and releases all entries on clear', () => {
  const cache = new TracePreviewCache(file);
  cache.remember(base, ready(base));
  expect(cache.get(base)?.paths).toHaveLength(0);
  expect(cache.get({ ...base, file: new File(['pixels'], file.name) })).toBeUndefined();
  cache.clear();
  expect(cache.get(base)).toBeUndefined();
});

it('does not collide invalid nonfinite values through JSON null encoding', () => {
  const cache = new TracePreviewCache(file);
  cache.remember(request(Number.NaN), ready(request(Number.NaN)));
  expect(cache.get(request(Number.POSITIVE_INFINITY))).toBeUndefined();
  const invalid = { ...base, boundary: { x: Number.NaN, y: 0, width: 20, height: 20 } };
  cache.remember(invalid, ready(invalid));
  expect(cache.get(invalid)).toBeUndefined();
});
