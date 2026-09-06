import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Clipper from 'clipper2-ts';

const engine = vi.hoisted(() => ({ union: vi.fn(), offset: vi.fn() }));
vi.mock('clipper2-ts', async (importOriginal) => {
  const actual = await importOriginal<typeof Clipper>();
  return {
    ...actual,
    unionD: engine.union.mockImplementation(actual.unionD),
    inflatePathsD: engine.offset.mockImplementation(actual.inflatePathsD),
  };
});

import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type Polyline } from '../scene';
import { compileJob } from './compile-job';
import { offsetFillContours } from './offset-fill';
import { offsetPreparedFillRegionChecked, prepareOffsetFillRegion } from './offset-fill-region';

const SQUARE: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ],
};

describe('Follow Shape checked region engine', () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof Clipper>('clipper2-ts');
    engine.union.mockReset().mockImplementation(actual.unionD);
    engine.offset.mockReset().mockImplementation(actual.inflatePathsD);
  });

  it('reports preparation failure through the fill result and named compiler diagnostic', () => {
    engine.union.mockImplementation(() => {
      throw new Error('union failed');
    });
    expect(offsetFillContours({ polylines: [SQUARE], spacingMm: 1 })).toEqual({
      contours: [],
      termination: { kind: 'offset-failed' },
    });
    const layer = {
      ...createLayer({ id: 'fill', color: '#ff0000', name: 'Prepared fill' }),
      mode: 'fill' as const,
      fillStyle: 'offset' as const,
    };
    const job = compileJob(
      {
        layers: [layer],
        objects: [
          {
            kind: 'imported-svg',
            id: 'square',
            source: 'square.svg',
            transform: IDENTITY_TRANSFORM,
            bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
            paths: [{ color: layer.color, polylines: [SQUARE] }],
          },
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );
    expect(job.groups).toEqual([]);
    expect(job.diagnostics).toEqual([{ kind: 'offset-fill-failed', layerName: 'Prepared fill' }]);
    expect(engine.offset).not.toHaveBeenCalled();
  });

  it('catches an offset engine exception rather than reporting natural completion', () => {
    engine.offset.mockImplementation(() => {
      throw new Error('offset failed');
    });
    expect(offsetFillContours({ polylines: [SQUARE], spacingMm: 1 })).toEqual({
      contours: [],
      termination: { kind: 'offset-failed' },
    });
  });

  it('cleans short offset needles while retaining the hole winding through later passes', () => {
    const outer = [
      { x: 1, y: 1 },
      { x: 19, y: 1 },
      { x: 19, y: 19 },
      { x: 18.999, y: 19 },
      { x: 1, y: 19 },
    ];
    const hole = [
      { x: 5, y: 5 },
      { x: 5, y: 15 },
      { x: 15, y: 15 },
      { x: 15, y: 5 },
    ];
    engine.offset.mockReturnValueOnce([outer, hole]);
    const result = offsetPreparedFillRegionChecked([SQUARE], -0.5);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('fixture offset failed');
    expect(result.value[0]?.points).toHaveLength(5);
    const holeContour = result.value[1];
    expect(holeContour?.points.slice(0, -1)).toEqual(hole);
    const next = offsetPreparedFillRegionChecked(result.value, -1);
    expect(next.kind).toBe('ok');
    const nextPaths = engine.offset.mock.calls[1]?.[0];
    expect(nextPaths?.[1]).toEqual(hole);
  });

  it('cleans preparation needles and treats an empty resolved region as completion', () => {
    engine.union.mockReturnValueOnce([
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 19.999, y: 20 },
        { x: 0, y: 20 },
      ],
    ]);
    const result = prepareOffsetFillRegion([SQUARE]);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('fixture preparation failed');
    expect(result.value[0]?.points).toHaveLength(5);
    engine.union.mockReturnValueOnce([]);
    expect(offsetFillContours({ polylines: [SQUARE], spacingMm: 1 })).toEqual({
      contours: [],
      termination: { kind: 'complete' },
    });
    expect(engine.offset).not.toHaveBeenCalled();
  });
});
