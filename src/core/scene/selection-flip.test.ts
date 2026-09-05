import { describe, expect, it } from 'vitest';
import { applyTransform } from './transform';
import { IDENTITY_TRANSFORM, type ImportedSvg } from './scene-object';
import { buildSelectionFlipEdit, selectionMetrics } from './selection-transform';

describe('world-axis selection reflection', () => {
  it.each(['horizontal', 'vertical'] as const)(
    'reflects all world vertices %s and is reversible',
    (axis) => {
      const points = [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 3, y: 10 },
      ];
      const objects: ImportedSvg[] = [30, 110].map((rotationDeg, index) => ({
        kind: 'imported-svg',
        id: `object-${index}`,
        source: 'triangle.svg',
        bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
        transform: {
          ...IDENTITY_TRANSFORM,
          x: 30 + index * 50,
          y: 20,
          rotationDeg,
          scaleX: 2,
          scaleY: 0.7,
          mirrorY: index === 1,
        },
        paths: [{ color: '#000000', polylines: [{ closed: true, points }] }],
      }));
      const bbox = selectionMetrics(objects)!.bbox;
      const result = buildSelectionFlipEdit(objects, axis);
      if (result.kind !== 'ok') throw new Error('expected reflection');
      const reflected = objects.map((object, index) => ({
        ...object,
        transform: result.transforms[index]!.transform,
      }));
      for (const [index, object] of objects.entries()) {
        for (const point of points) {
          const before = applyTransform(point, object.transform);
          const after = applyTransform(point, reflected[index]!.transform);
          expect(after.x).toBeCloseTo(
            axis === 'horizontal' ? bbox.minX + bbox.maxX - before.x : before.x,
            8,
          );
          expect(after.y).toBeCloseTo(
            axis === 'vertical' ? bbox.minY + bbox.maxY - before.y : before.y,
            8,
          );
        }
      }
      const twice = buildSelectionFlipEdit(reflected, axis);
      if (twice.kind !== 'ok') throw new Error('expected second reflection');
      objects.forEach((object, index) =>
        points.forEach((point) => {
          const original = applyTransform(point, object.transform);
          const restored = applyTransform(point, twice.transforms[index]!.transform);
          expect(restored.x).toBeCloseTo(original.x, 8);
          expect(restored.y).toBeCloseTo(original.y, 8);
        }),
      );
    },
  );
});
