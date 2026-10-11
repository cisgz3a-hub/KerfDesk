import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  createLayer,
  flattenCurveSubpath,
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type Scene,
  type TracedImage,
} from '../../core/scene';
import { boundsFromColoredPaths } from '../../core/trace/trace-bounds';
import { HYBRID_STROKE_COLOR } from '../../core/trace/hybrid/hybrid-paths';
import { hitTracePart } from './trace-part-hit-test';

function square(x: number, y: number, size: number): Polyline {
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

function line(y: number): Polyline {
  return {
    closed: false,
    points: [
      { x: 0, y },
      { x: 100, y },
    ],
  };
}

function trace(paths: ReadonlyArray<ColoredPath>, options: Partial<TracedImage> = {}): TracedImage {
  return {
    kind: 'traced-image',
    id: 'trace',
    source: 'drawing.png',
    transform: IDENTITY_TRANSFORM,
    bounds: boundsFromColoredPaths(paths),
    paths,
    ...options,
  };
}

function scene(...objects: TracedImage[]): Scene {
  return { objects, layers: [] };
}

describe('picking an individual trace part', () => {
  it('chooses the closest segment across subpaths and colours rather than the first candidate', () => {
    const object = trace(
      [
        { color: '#000000', polylines: [line(0), line(2)] },
        { color: '#ff0000', polylines: [line(3)] },
      ],
      { traceMode: 'centerline' },
    );
    expect(hitTracePart(scene(object), { x: 50, y: 1.8 }, 0.5)).toEqual({
      objectId: 'trace',
      pathIndex: 0,
      subpathIndex: 1,
    });
    expect(hitTracePart(scene(object), { x: 50, y: 2.8 }, 0.5)).toEqual({
      objectId: 'trace',
      pathIndex: 1,
      subpathIndex: 0,
    });
  });

  it.each([0.02, 0.25, 2])(
    'keeps the hit reach at six screen pixels with %s mm per pixel',
    (pxToMm) => {
      const object = trace([{ color: '#000000', polylines: [line(0)] }], {
        traceMode: 'centerline',
      });
      expect(hitTracePart(scene(object), { x: 50, y: 5.9 * pxToMm }, pxToMm)).not.toBeNull();
      expect(hitTracePart(scene(object), { x: 50, y: 6.1 * pxToMm }, pxToMm)).toBeNull();
    },
  );

  it('measures the screen distance after rotation, mirroring and nonuniform scaling', () => {
    const transform = {
      ...IDENTITY_TRANSFORM,
      x: 200,
      y: 80,
      rotationDeg: 37,
      scaleX: 2.4,
      scaleY: 0.15,
      mirrorX: true,
      mirrorY: true,
    };
    const object = trace([{ color: '#000000', polylines: [line(0), line(40)] }], {
      transform,
      traceMode: 'centerline',
    });
    const point = applyTransform({ x: 50, y: 40 }, transform);
    const radians = (transform.rotationDeg * Math.PI) / 180;
    const offset = (distance: number) => ({
      x: point.x + Math.sin(radians) * distance,
      y: point.y - Math.cos(radians) * distance,
    });
    expect(hitTracePart(scene(object), offset(1.49), 0.25)).toEqual({
      objectId: 'trace',
      pathIndex: 0,
      subpathIndex: 1,
    });
    expect(hitTracePart(scene(object), offset(1.51), 0.25)).toBeNull();
  });

  it('picks filled interiors while leaving a hole empty and its edge selectable', () => {
    const object = trace([
      {
        color: '#000000',
        fillRule: 'evenodd',
        polylines: [square(0, 0, 100), square(20, 20, 60), square(40, 40, 20)],
      },
    ]);
    expect(hitTracePart(scene(object), { x: 10, y: 50 }, 0.1)).toEqual({
      objectId: 'trace',
      pathIndex: 0,
      subpathIndex: 0,
    });
    expect(hitTracePart(scene(object), { x: 30, y: 50 }, 0.1)).toBeNull();
    expect(hitTracePart(scene(object), { x: 20.3, y: 50 }, 0.1)).toEqual({
      objectId: 'trace',
      pathIndex: 0,
      subpathIndex: 1,
    });
    expect(hitTracePart(scene(object), { x: 50, y: 50 }, 0.1)).toEqual({
      objectId: 'trace',
      pathIndex: 0,
      subpathIndex: 2,
    });
  });

  it('respects nonzero winding for same-direction fills and opposite-direction holes', () => {
    const inner = square(20, 20, 60);
    const object = (hole: boolean) =>
      trace([
        {
          color: '#000000',
          fillRule: 'nonzero',
          polylines: [
            square(0, 0, 100),
            hole ? { ...inner, points: [...inner.points].reverse() } : inner,
          ],
        },
      ]);
    expect(hitTracePart(scene(object(false)), { x: 50, y: 50 }, 0.1)).toEqual({
      objectId: 'trace',
      pathIndex: 0,
      subpathIndex: 0,
    });
    expect(hitTracePart(scene(object(true)), { x: 50, y: 50 }, 0.1)).toBeNull();
  });

  it.each(['centerline', 'hybrid'] as const)(
    'does not fill a closed %s stroke for picking',
    (traceMode) => {
      const object = trace(
        [
          {
            color: traceMode === 'hybrid' ? HYBRID_STROKE_COLOR : '#000000',
            polylines: [square(0, 0, 100)],
          },
        ],
        { traceMode },
      );
      expect(hitTracePart(scene(object), { x: 50, y: 50 }, 0.1)).toBeNull();
      expect(hitTracePart(scene(object), { x: 0.5, y: 50 }, 0.1)).not.toBeNull();
    },
  );

  it('skips locked traces and hidden operations even when another operation has the same colour', () => {
    const paths = [{ color: '#000000', polylines: [line(0)], operationIds: ['hidden'] }];
    const bottom = trace([{ color: '#000000', polylines: [line(0)], operationIds: ['shown'] }], {
      id: 'bottom',
    });
    const top = trace(paths, { id: 'top' });
    const layers = [
      { ...createLayer({ color: '#000000', id: 'shown' }), visible: true },
      { ...createLayer({ color: '#000000', id: 'hidden' }), visible: false },
    ];
    expect(hitTracePart({ objects: [bottom, top], layers }, { x: 50, y: 0 }, 0.1)?.objectId).toBe(
      'bottom',
    );
    expect(
      hitTracePart({ objects: [{ ...bottom, locked: true }, top], layers }, { x: 50, y: 0 }, 0.1),
    ).toBeNull();
    expect(
      hitTracePart(scene(bottom, { ...bottom, id: 'top' }), { x: 50, y: 0 }, 0.1)?.objectId,
    ).toBe('top');
  });

  it('finds a canonical curve when no compatibility polyline has been stored', () => {
    const object = trace(
      [
        {
          color: '#000000',
          polylines: [],
          curves: [polylineToCurveSubpath(line(10))],
        },
      ],
      { traceMode: 'centerline' },
    );
    expect(hitTracePart(scene(object), { x: 50, y: 10 }, 0.1)).toEqual({
      objectId: 'trace',
      pathIndex: 0,
      subpathIndex: 0,
    });
  });

  it.each([
    { scaleX: 10, scaleY: 10, rotationDeg: 0, mirrorX: false },
    { scaleX: 40, scaleY: 0.1, rotationDeg: 27, mirrorX: true },
  ])(
    'picks the canonical cubic at high zoom after coarse cache warming with transform %j',
    (transform) => {
      const curve: CurveSubpath = {
        start: { x: 0, y: 0 },
        closed: false,
        segments: [
          {
            kind: 'cubic',
            control1: { x: 0, y: 10 },
            control2: { x: 10, y: 10 },
            to: { x: 10, y: 0 },
          },
        ],
      };
      const coarse = flattenCurveSubpath(curve, { toleranceMm: 0.05 });
      if (coarse.kind !== 'ok') throw new Error('cubic fixture exceeds segment budget');
      const path = { color: '#000000', polylines: [coarse.polyline], curves: [curve] };
      const object = trace([path], {
        traceMode: 'centerline',
        transform: { ...IDENTITY_TRANSFORM, ...transform },
      });
      // Exact cubic point at t=.01, independent of either cached chord approximation.
      // With a uniform 10x transform it lies at world (0.0298, 2.97).
      const point = applyTransform({ x: 0.00298, y: 0.297 }, object.transform);
      for (const pxToMm of [2, 0.02, 0.002, 0.2, 0.002]) {
        expect(hitTracePart(scene(object), point, pxToMm)).toEqual({
          objectId: 'trace',
          pathIndex: 0,
          subpathIndex: 0,
        });
      }
      expect(path.polylines).toEqual([coarse.polyline]);
      expect(path.curves).toEqual([curve]);
    },
  );

  it('hits one of thousands of contours without mutating or expanding the scene', () => {
    const polylines = Array.from({ length: 5000 }, (_, index) => line(index * 3));
    const object = trace([{ color: '#000000', polylines }], { traceMode: 'centerline' });
    const originalScene = scene(object);
    for (const index of [0, 2500, 4999]) {
      expect(hitTracePart(originalScene, { x: 50, y: index * 3 + 0.4 }, 0.1)).toEqual({
        objectId: 'trace',
        pathIndex: 0,
        subpathIndex: index,
      });
    }
    expect(originalScene.objects).toEqual([object]);
    expect(object.paths[0]?.polylines).toBe(polylines);
    expect(polylines).toHaveLength(5000);
  });

  it('rejects invalid view scales and collapsed object transforms', () => {
    const object = trace([{ color: '#000000', polylines: [line(0)] }]);
    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(hitTracePart(scene(object), { x: 50, y: 0 }, scale)).toBeNull();
    }
    expect(
      hitTracePart(
        scene({ ...object, transform: { ...IDENTITY_TRANSFORM, scaleY: 0 } }),
        { x: 50, y: 0 },
        1,
      ),
    ).toBeNull();
  });
});
