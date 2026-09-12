import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unionD } from 'clipper2-ts';
import { describe, expect, it, vi } from 'vitest';
import { compilationPolylines } from '../job/compilation-polylines';
import {
  flattenColoredPathCurves,
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type ColoredPath,
  type Polyline,
  type Vec2,
} from '../scene';
import { bendTextRender } from './text-bend';
import { textToPolylines, type TextRenderResult } from './text-to-polylines';
import { weldTextRender } from './text-weld';

vi.mock('clipper2-ts', async (importOriginal) => {
  const actual = await importOriginal<{ readonly unionD: typeof unionD }>();
  return { ...actual, unionD: vi.fn(actual.unionD) };
});

function box(x: number, y: number, width: number, height = width): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
      { x, y },
    ],
  };
}

function renderPolylines(polylines: ReadonlyArray<Polyline>): TextRenderResult {
  return {
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    paths: [{ color: '#000000', polylines }],
  };
}

async function renderFont(content: string, fileName = 'DancingScript-Regular.ttf', sizeMm = 40) {
  const bytes = readFileSync(resolve(__dirname, '../../ui/text/fonts', fileName));
  return textToPolylines({
    fontBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    content,
    sizeMm,
    alignment: 'left',
    lineHeight: 1.4,
    color: '#123456',
  });
}

function weld(rendered: TextRenderResult): TextRenderResult {
  const result = weldTextRender(rendered);
  if (result.kind !== 'ok') throw new Error(result.error.message);
  return result.value;
}

function contours(rendered: TextRenderResult): ReadonlyArray<Polyline> {
  return rendered.paths.flatMap((path) => {
    const flattened = flattenColoredPathCurves(path, { toleranceMm: 0.001 });
    if (flattened.kind !== 'ok') throw new Error('Fixture flattening failed.');
    return flattened.polylines;
  });
}

function windingAt(point: Vec2, polylines: ReadonlyArray<Polyline>): number {
  let winding = 0;
  for (const polyline of polylines) {
    for (let index = 0; index < polyline.points.length; index += 1) {
      const from = polyline.points[index];
      const to = polyline.points[(index + 1) % polyline.points.length];
      if (from === undefined || to === undefined) continue;
      const cross = (to.x - from.x) * (point.y - from.y) - (point.x - from.x) * (to.y - from.y);
      if (from.y <= point.y && to.y > point.y && cross > 0) winding += 1;
      if (from.y > point.y && to.y <= point.y && cross < 0) winding -= 1;
    }
  }
  return winding;
}

function assertResolvedJoins(source: TextRenderResult, resolved: TextRenderResult): void {
  const raw = contours(source);
  const merged = contours(resolved);
  let overlapSamples = 0;
  for (let iy = 0; iy < 80; iy += 1) {
    for (let ix = 0; ix < 80; ix += 1) {
      const point = {
        x: source.bounds.minX + ((ix + 0.31) / 80) * (source.bounds.maxX - source.bounds.minX),
        y: source.bounds.minY + ((iy + 0.47) / 80) * (source.bounds.maxY - source.bounds.minY),
      };
      const before = windingAt(point, raw);
      const after = windingAt(point, merged);
      expect(after !== 0).toBe(before !== 0);
      if (Math.abs(before) >= 2) {
        overlapSamples += 1;
        expect(Math.abs(after)).toBe(1);
      }
    }
  }
  expect(overlapSamples).toBeGreaterThan(0);
}

function distanceToBoundary(point: Vec2, paths: ReadonlyArray<Polyline>): number {
  let closest = Infinity;
  for (const path of paths) {
    for (let index = 1; index < path.points.length; index += 1) {
      const from = path.points[index - 1] as Vec2;
      const to = path.points[index] as Vec2;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(
              0,
              Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
            );
      closest = Math.min(closest, Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy));
    }
  }
  return closest;
}

describe('editable text outline welding', () => {
  it.each(['DancingScript-Regular.ttf', 'Pacifico-Regular.ttf'])(
    'removes the crossing joins in real %s my outlines while retaining the y counter',
    async (font) => {
      const source = await renderFont('my', font);
      const resolved = weld(source);
      expect(contours(resolved).length).toBeLessThan(contours(source).length);
      expect(resolved.bounds).toBe(source.bounds);
      assertResolvedJoins(source, resolved);
    },
  );

  it('retains a nested counter while removing a same-wound overlap', () => {
    const outer = box(0, 0, 10);
    const counter = { ...box(2, 2, 3), points: [...box(2, 2, 3).points].reverse() };
    const source = renderPolylines([outer, counter, box(8, 0, 10)]);
    const resolved = contours(weld(source));
    expect(resolved).toHaveLength(2);
    expect(windingAt({ x: 3, y: 3 }, resolved)).toBe(0);
    expect(windingAt({ x: 9, y: 5 }, resolved)).toBe(1);
  });

  it('preserves native curves when their boundaries do not overlap', async () => {
    const source = await renderFont('ABC O', 'Roboto-Regular.ttf');
    expect(weld(source)).toBe(source);
    expect(
      source.paths[0]?.curves?.some((curve) => curve.segments.some((s) => s.kind === 'cubic')),
    ).toBe(true);
  });

  it('uses native curves instead of stale compatibility outlines and exports the welded result', async () => {
    const source = await renderFont('my');
    const stale = {
      ...source,
      paths: source.paths.map((path) => ({ ...path, polylines: [box(1000, 1000, 10)] })),
    };
    const resolved = weld(stale);
    assertResolvedJoins(source, resolved);
    const path = resolved.paths[0] as ColoredPath;
    const compiled = compilationPolylines(path, IDENTITY_TRANSFORM);
    expect(compiled).toEqual(path.polylines);
    expect(compiled.flatMap((polyline) => polyline.points).every((point) => point.x < 1000)).toBe(
      true,
    );
    expect(
      path.curves?.every((curve) => curve.segments.every((segment) => segment.kind === 'line')),
    ).toBe(true);
  });

  it('retains separate lines while welding the joins on each line', async () => {
    const source = await renderFont('my\nmy');
    const resolved = weld(source);
    expect(contours(resolved).length).toBeLessThan(contours(source).length);
    assertResolvedJoins(source, resolved);
  });

  it('welds the final bent geometry and keeps its local origin and bounds', async () => {
    const bent = bendTextRender(await renderFont('my'), 65);
    const resolved = weld(bent);
    expect(resolved.bounds).toBe(bent.bounds);
    assertResolvedJoins(bent, resolved);
  });

  it('keeps very small counters and joins instead of collapsing sub-millimetre detail', () => {
    const counter = box(0.001, 0.001, 0.0004);
    const source = renderPolylines([
      box(0, 0, 0.003),
      { ...counter, points: [...counter.points].reverse() },
      box(0.002, 0, 0.003),
    ]);
    const resolved = contours(weld(source));
    expect(resolved).toHaveLength(2);
    expect(windingAt({ x: 0.0012, y: 0.0012 }, resolved)).toBe(0);
    expect(windingAt({ x: 0.0025, y: 0.0012 }, resolved)).toBe(1);
  });

  it.each([2, 400])(
    'bounds welded curve deviation for %s mm type even after 10x scaling',
    async (size) => {
      const source = await renderFont('my', 'DancingScript-Regular.ttf', size);
      const reference = source.paths.flatMap((path) => {
        const flattened = flattenColoredPathCurves(path, { toleranceMm: 0.00005 });
        if (flattened.kind !== 'ok') throw new Error('Reference flattening failed.');
        return flattened.polylines;
      });
      const resolved = weld(source);
      for (const path of resolved.paths) {
        const compiled = compilationPolylines(path, {
          ...IDENTITY_TRANSFORM,
          scaleX: 10,
          scaleY: 10,
        });
        for (const contour of compiled) {
          for (let index = 1; index < contour.points.length; index += 1) {
            const from = contour.points[index - 1] as Vec2;
            const to = contour.points[index] as Vec2;
            const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
            expect(distanceToBoundary(middle, reference) * 10).toBeLessThan(0.011);
          }
        }
      }
    },
    // Dense independent accuracy sampling is not a latency assertion.
    30_000,
  );

  it('keeps open-only single-line text byte-identical', () => {
    const open = { ...box(0, 0, 10), closed: false };
    const source = renderPolylines([open]);
    expect(weld(source)).toBe(source);
  });

  it('preserves exact open strokes and their native curves in a mixed batch', () => {
    const open: Polyline = {
      closed: false,
      points: [
        { x: 1, y: 20 },
        { x: 9, y: 20 },
      ],
    };
    const openCurve = {
      start: open.points[0] as Vec2,
      closed: false,
      segments: [
        {
          kind: 'cubic' as const,
          control1: { x: 3, y: 21 },
          control2: { x: 7, y: 21 },
          to: open.points[1] as Vec2,
        },
      ],
    };
    const closed = [box(0, 0, 10), box(6, 0, 10)];
    const source: TextRenderResult = {
      ...renderPolylines([]),
      paths: [
        {
          color: '#123456',
          operationIds: ['operation-7'],
          strokeWidthMm: 0.2,
          polylines: [...closed, open],
          curves: [...closed.map(polylineToCurveSubpath), openCurve],
        },
      ],
    };
    const result = weld(source).paths[0] as ColoredPath;
    expect(result.polylines.filter((p) => p.closed)).toHaveLength(1);
    expect(result.polylines.find((p) => !p.closed)).toBe(open);
    expect(result.curves?.find((curve) => !curve.closed)).toBe(openCurve);
    expect(result).toMatchObject({
      color: '#123456',
      operationIds: ['operation-7'],
      strokeWidthMm: 0.2,
    });
  });

  it('does not weld separate render batches together', () => {
    const source: TextRenderResult = {
      ...renderPolylines([]),
      paths: [
        { color: '#ff0000', polylines: [box(0, 0, 10)] },
        { color: '#0000ff', polylines: [box(6, 0, 10)] },
      ],
    };
    expect(weld(source)).toBe(source);
  });

  it('returns a typed engine failure without reporting the original outlines as welded', () => {
    vi.mocked(unionD).mockImplementationOnce(() => {
      throw new Error('engine failed');
    });
    const source = renderPolylines([box(0, 0, 10), box(6, 0, 10)]);
    expect(weldTextRender(source)).toMatchObject({
      kind: 'error',
      error: { kind: 'operation-failed' },
    });
    expect(source.paths[0]?.polylines).toHaveLength(2);
  });

  it('returns a typed empty result rather than silently dropping the artwork', () => {
    vi.mocked(unionD).mockReturnValueOnce([]);
    expect(weldTextRender(renderPolylines([box(0, 0, 10)]))).toMatchObject({
      kind: 'error',
      error: { kind: 'empty-result' },
    });
  });
});
