import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg, type Polyline, type TextObject } from '../scene';
import { weldVectorObjects } from './vector-path-weld';
import { describeWeldChange } from './vector-path-weld-change';
import type { VectorSceneObject } from './vector-path-tools';

function rectangle(x0: number, y0: number, x1: number, y1: number): Polyline {
  return {
    closed: true,
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
      { x: x0, y: y0 },
    ],
  };
}

/** Off-grid vertices, like a flattened parametric ellipse. */
function ellipse(cx: number, cy: number, rx: number, ry: number): Polyline {
  const points = Array.from({ length: 96 }, (_, index) => {
    const angle = (index / 96) * Math.PI * 2;
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  });
  return { closed: true, points: [...points, points[0]!] };
}

function artwork(
  id: string,
  polylines: ReadonlyArray<Polyline>,
  operationIds: ReadonlyArray<string> = ['cut'],
): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: id,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 160 },
    transform: IDENTITY_TRANSFORM,
    operationIds,
    paths: [{ color: '#000000', polylines }],
  };
}

function text(id: string, polylines: ReadonlyArray<Polyline>, operationIds = ['cut']): TextObject {
  return {
    kind: 'text',
    id,
    content: 'JOHANN',
    fontKey: 'builtin:sans',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 160 },
    transform: IDENTITY_TRANSFORM,
    operationIds,
    paths: [{ color: '#000000', polylines }],
  };
}

function change(sources: ReadonlyArray<VectorSceneObject>) {
  const welded = weldVectorObjects(sources, 'welded');
  if (welded.kind === 'error') throw new Error(welded.error.message);
  return describeWeldChange(sources, welded.value);
}

const letters = [rectangle(20, 75, 28, 85), rectangle(32, 75, 40, 85), rectangle(44, 75, 52, 85)];

describe('describeWeldChange', () => {
  it('preserves a real narrow bridge even when its uncovered area is below a perimeter tolerance', () => {
    expect(
      change([
        artwork('left', [rectangle(0, 0, 10, 10)]),
        artwork('right', [rectangle(10.002, 0, 20.002, 10)]),
        artwork('bridge', [rectangle(5, 4, 15, 6)]),
      ]),
    ).toEqual({ changed: true, absorbedIds: [] });
  });

  it('reports no change for one ellipse on its own', () => {
    expect(change([artwork('ellipse', [ellipse(50, 80, 50, 80)])])).toEqual({
      changed: false,
      absorbedIds: [],
    });
  });

  it('reports no change for separate shapes in one operation', () => {
    expect(
      change([artwork('a', [rectangle(0, 0, 10, 10)]), artwork('b', [rectangle(20, 0, 30, 10)])]),
    ).toEqual({ changed: false, absorbedIds: [] });
  });

  it('reports no change for a shape with a hole', () => {
    expect(
      change([artwork('donut', [ellipse(50, 50, 40, 40), ellipse(50, 50, 20, 20)])]).changed,
    ).toBe(false);
  });

  it('reports no change after baking a transform', () => {
    const moved = {
      ...artwork('moved', [ellipse(0, 0, 10, 6)]),
      transform: { ...IDENTITY_TRANSFORM, x: 33.3333, y: 7.77777, scaleX: 1.7, rotationDeg: 31 },
    };
    expect(change([moved, artwork('other', [rectangle(-80, -80, -60, -60)])]).changed).toBe(false);
  });

  it('reports overlapping and edge-sharing shapes as changed', () => {
    expect(
      change([artwork('a', [rectangle(0, 0, 10, 10)]), artwork('b', [rectangle(5, 0, 15, 10)])]),
    ).toEqual({ changed: true, absorbedIds: [] });
    expect(
      change([artwork('a', [rectangle(0, 0, 10, 10)]), artwork('b', [rectangle(10, 0, 20, 10)])])
        .changed,
    ).toBe(true);
  });

  it('reports overlapping letters inside one text object as changed', () => {
    expect(change([text('script', [rectangle(0, 0, 10, 10), rectangle(8, 0, 18, 10)])])).toEqual({
      changed: true,
      absorbedIds: [],
    });
  });

  it('names text inside an ellipse in the same operation as absorbed', () => {
    expect(change([artwork('ellipse', [ellipse(50, 80, 50, 80)]), text('text', letters)])).toEqual({
      changed: true,
      absorbedIds: ['text'],
    });
  });

  it('reports no change for text inside an ellipse in another operation', () => {
    expect(
      change([artwork('ellipse', [ellipse(50, 80, 50, 80)]), text('text', letters, ['engrave'])]),
    ).toEqual({ changed: false, absorbedIds: [] });
  });

  it('does not name a source that is only partly covered', () => {
    expect(
      change([
        artwork('ellipse', [ellipse(50, 80, 50, 80)]),
        text('text', [...letters, rectangle(90, 75, 110, 85)]),
      ]),
    ).toEqual({ changed: true, absorbedIds: [] });
  });

  // Audit 2026-10-21 geometry P2-1: every corner of the bar sits inside a
  // circle, so none of its vertices survives, yet its middle is the bridge.
  it('does not name a bar that bridges two shapes', () => {
    const bridged = [
      artwork('left', [ellipse(0, 0, 8, 8)]),
      artwork('right', [ellipse(30, 0, 8, 8)]),
      artwork('bar', [rectangle(5, -1, 25, 1)]),
    ];
    const welded = weldVectorObjects(bridged, 'welded');
    if (welded.kind === 'error') throw new Error(welded.error.message);
    expect(welded.value.paths.flatMap((path) => path.polylines)).toHaveLength(1);
    expect(describeWeldChange(bridged, welded.value)).toEqual({ changed: true, absorbedIds: [] });
  });

  it('names a shape covered only by several others together', () => {
    expect(
      change([
        artwork('left', [rectangle(0, 0, 12, 10)]),
        artwork('right', [rectangle(10, 0, 22, 10)]),
        artwork('inner', [rectangle(5, 2, 17, 8)]),
      ]),
    ).toEqual({ changed: true, absorbedIds: ['inner'] });
  });

  it('names only one of two identical bridges, since Weld keeps the other', () => {
    expect(
      change([
        artwork('left', [ellipse(0, 0, 8, 8)]),
        artwork('right', [ellipse(30, 0, 8, 8)]),
        artwork('bar', [rectangle(5, -1, 25, 1)]),
        artwork('copy', [rectangle(5, -1, 25, 1)]),
      ]),
    ).toEqual({ changed: true, absorbedIds: ['bar'] });
  });

  it('does not count a shape in another operation towards covering a source', () => {
    expect(
      change([
        artwork('left', [rectangle(0, 0, 12, 10)]),
        artwork('right', [rectangle(10, 0, 22, 10)], ['engrave']),
        artwork('inner', [rectangle(5, 2, 17, 8)]),
      ]).absorbedIds,
    ).toEqual([]);
  });
});
