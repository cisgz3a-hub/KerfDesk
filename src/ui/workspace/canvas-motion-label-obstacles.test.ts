import { describe, expect, it } from 'vitest';
import { createLayer, IDENTITY_TRANSFORM, type ImportedSvg, type Scene } from '../../core/scene';
import { canvasStartLabelObstacles } from './canvas-motion-label-obstacles';

const VIEW = { scale: 1, offsetX: 0, offsetY: 0 };
const NONE: ReadonlySet<string> = new Set();

function object(id: string, x = 0): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x },
    paths: [{ color: '#000000', polylines: [] }],
  };
}

function scene(objects: Scene['objects']): Scene {
  return { objects, layers: [createLayer({ id: 'visible', color: '#000000' })] };
}

describe('canvas start-label obstacle evidence', () => {
  it.each([0.25, 1, 4])(
    'covers mirrored/rotated artwork at zoom %s with fixed pixel clearance',
    (scale) => {
      const artwork: ImportedSvg = {
        ...object('rotated'),
        bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
        transform: {
          ...IDENTITY_TRANSFORM,
          x: 100,
          y: 50,
          scaleX: 2,
          mirrorX: true,
          rotationDeg: 90,
        },
      };
      const obstacles = canvasStartLabelObstacles(
        scene([artwork]),
        { scale, offsetX: 30, offsetY: 40 },
        null,
        NONE,
      );
      expect(obstacles).toHaveLength(1);
      // Independently rotated corners occupy x=80..100, y=-30..50 mm.
      expect(obstacles[0]?.x).toBeCloseTo(30 + 80 * scale - 6);
      expect(obstacles[0]?.y).toBeCloseTo(40 - 30 * scale - 6);
      expect(obstacles[0]?.width).toBeCloseTo(20 * scale + 12);
      expect(obstacles[0]?.height).toBeCloseTo(80 * scale + 12);
    },
  );

  it('follows visible operation bindings, including output-off and orphan artwork', () => {
    const objects = [
      { ...object('hidden'), operationIds: ['hidden'] },
      { ...object('mixed', 20), operationIds: ['hidden', 'visible'] },
      { ...object('orphan', 40), operationIds: ['missing'] },
    ];
    const source = {
      objects,
      layers: [
        { ...createLayer({ id: 'visible', color: '#000000' }), output: false },
        { ...createLayer({ id: 'hidden', color: '#ff0000' }), visible: false },
      ],
    };
    const obstacles = canvasStartLabelObstacles(source, VIEW, 'hidden', NONE);
    expect(obstacles).toEqual([
      { x: 14, y: -6, width: 22, height: 22 },
      { x: 34, y: -6, width: 22, height: 22 },
    ]);
  });

  it('reserves the combined selection frame and rotation handle above separate objects', () => {
    const obstacles = canvasStartLabelObstacles(
      scene([object('a'), object('b', 50)]),
      VIEW,
      'a',
      new Set(['b']),
    );
    expect(obstacles).toContainEqual({ x: -9, y: -9, width: 78, height: 28 });
    expect(obstacles).toContainEqual({ x: 21, y: -33, width: 18, height: 42 });
  });

  it('uses object bounds without reading dense polyline coordinates', () => {
    const dense = {
      ...object('dense'),
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: false,
              get points(): never {
                throw new Error('Dense path traversal');
              },
            },
          ],
        },
      ],
    };
    const source = scene(
      Array.from({ length: 500 }, (_, index) => ({ ...dense, id: `dense-${index}` })),
    );
    expect(canvasStartLabelObstacles(source, VIEW, null, NONE)).toHaveLength(500);
  });
});
