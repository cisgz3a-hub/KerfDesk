import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PolygonDifferenceModule from '../geometry/polygon-difference';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type SceneObject } from '../scene';
import { compileJob } from './compile-job';
import type { FillGroup } from './job';

const normalizationControl = vi.hoisted(() => ({
  evenOddCalls: 0,
  nonZeroCalls: 0,
  evenOddFailures: new Set<number>(),
  nonZeroFailures: new Set<number>(),
}));

vi.mock('../geometry/polygon-difference', async (importOriginal) => {
  const actual = await importOriginal<typeof PolygonDifferenceModule>();
  const failure = (): ReturnType<typeof actual.normalizeClosedPolylinesEvenOddChecked> => ({
    kind: 'error',
    error: { kind: 'operation-failed', message: 'Targeted normalization failure.' },
  });
  return {
    ...actual,
    normalizeClosedPolylinesEvenOddChecked: (
      ...args: Parameters<typeof actual.normalizeClosedPolylinesEvenOddChecked>
    ) => {
      normalizationControl.evenOddCalls += 1;
      return normalizationControl.evenOddFailures.has(normalizationControl.evenOddCalls)
        ? failure()
        : actual.normalizeClosedPolylinesEvenOddChecked(...args);
    },
    normalizeClosedPolylinesNonZeroChecked: (
      ...args: Parameters<typeof actual.normalizeClosedPolylinesNonZeroChecked>
    ) => {
      normalizationControl.nonZeroCalls += 1;
      return normalizationControl.nonZeroFailures.has(normalizationControl.nonZeroCalls)
        ? failure()
        : actual.normalizeClosedPolylinesNonZeroChecked(...args);
    },
  };
});

const dev = DEFAULT_DEVICE_PROFILE;

describe('layer fill render-batch semantics', () => {
  beforeEach(() => {
    normalizationControl.evenOddCalls = 0;
    normalizationControl.nonZeroCalls = 0;
    normalizationControl.evenOddFailures.clear();
    normalizationControl.nonZeroFailures.clear();
  });

  it('normalizes each ColoredPath before pooling one object', () => {
    const separateBatches = artwork('separate-batches', [[square(0, 0, 10)], [square(5, 0, 10)]]);
    const oneCompoundBatch = artwork('one-compound-batch', [[square(0, 0, 10), square(5, 0, 10)]]);

    expect(rowFor(separateBatches)).toEqual([{ minX: 0, maxX: 15, length: 15 }]);
    expect(rowFor(oneCompoundBatch)).toEqual([
      { minX: 0, maxX: 5, length: 5 },
      { minX: 10, maxX: 15, length: 5 },
    ]);
  });

  it('keeps same-wound overlapping Text geometry filled under non-zero semantics', () => {
    const text: SceneObject = {
      kind: 'text',
      id: 'connected-script',
      content: 'connected',
      fontKey: 'fixture-font',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1,
      letterSpacing: 0,
      color: '#ff0000',
      bounds: { minX: 0, minY: 0, maxX: 15, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#ff0000',
          polylines: [square(0, 0, 10), square(5, 0, 10)],
        },
      ],
    };

    expect(rowFor(text)).toEqual([{ minX: 0, maxX: 15, length: 15 }]);
  });

  it('falls back to raw layer even-odd semantics after a per-batch failure', () => {
    normalizationControl.evenOddFailures.add(1);
    const separateBatches = artwork('batch-failure', [[square(0, 0, 10)], [square(5, 0, 10)]]);

    expect(rowFor(separateBatches)).toEqual([
      { minX: 0, maxX: 5, length: 5 },
      { minX: 10, maxX: 15, length: 5 },
    ]);
    expect(normalizationControl.evenOddCalls).toBe(2);
    expect(normalizationControl.nonZeroCalls).toBe(0);
  });

  it('keeps normalized batches when only the object-union step fails', () => {
    normalizationControl.nonZeroFailures.add(1);
    const separateBatches = artwork('object-union-failure', [
      [square(0, 0, 10)],
      [square(5, 0, 10)],
    ]);

    expect(rowFor(separateBatches)).toEqual([
      { minX: 0, maxX: 5, length: 5 },
      { minX: 10, maxX: 15, length: 5 },
    ]);
    expect(normalizationControl.evenOddCalls).toBe(2);
    expect(normalizationControl.nonZeroCalls).toBe(1);
  });

  it('uses the documented raw Text fallback when its batch normalization fails', () => {
    normalizationControl.nonZeroFailures.add(1);
    const text: SceneObject = {
      kind: 'text',
      id: 'text-failure',
      content: 'connected',
      fontKey: 'fixture-font',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1,
      letterSpacing: 0,
      color: '#ff0000',
      bounds: { minX: 0, minY: 0, maxX: 15, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [{ color: '#ff0000', polylines: [square(0, 0, 10), square(5, 0, 10)] }],
    };

    expect(rowFor(text)).toEqual([
      { minX: 0, maxX: 5, length: 5 },
      { minX: 10, maxX: 15, length: 5 },
    ]);
    expect(normalizationControl.nonZeroCalls).toBe(1);
  });
});

function artwork(
  id: string,
  batches: ReadonlyArray<ReadonlyArray<ReturnType<typeof square>>>,
): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 15, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: batches.map((polylines) => ({ color: '#ff0000', polylines })),
  };
}

function rowFor(object: SceneObject) {
  const layer = {
    ...createLayer({ id: 'fill', color: '#ff0000' }),
    mode: 'fill' as const,
    hatchSpacingMm: 1,
    hatchAngleDeg: 0,
  };
  const first = compileJob({ objects: [object], layers: [layer] }, dev).groups[0];
  const fill: FillGroup | undefined = first?.kind === 'fill' ? first : undefined;
  return (fill?.segments ?? [])
    .filter((segment) => {
      const a = segment.polyline[0];
      const b = segment.polyline[1];
      return (
        a !== undefined &&
        b !== undefined &&
        Math.abs(a.y - (dev.bedHeight - 5)) < 1e-6 &&
        Math.abs(b.y - (dev.bedHeight - 5)) < 1e-6
      );
    })
    .map((segment) => {
      const a = segment.polyline[0];
      const b = segment.polyline[1];
      if (a === undefined || b === undefined) return { minX: 0, maxX: 0, length: 0 };
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      return { minX, maxX, length: maxX - minX };
    });
}

function square(x: number, y: number, size: number) {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}
