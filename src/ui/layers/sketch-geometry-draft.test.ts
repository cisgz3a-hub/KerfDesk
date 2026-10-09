import { describe, expect, it } from 'vitest';
import {
  appendSketchPrimitive,
  removeSketchEntity,
  sketchFromTemplate,
} from './sketch-geometry-draft';
import { materializeConstrainedSketch } from '../../core/sketch-constraints/materialize-constrained-sketch';
import { parseConstrainedSketch } from '../../core/sketch-constraints/sketch-validation';
describe('editable sketch geometry', () => {
  it.each(['plate', 'rectangle', 'circle'] as const)(
    'materializes the %s template into finite closed output',
    (kind) => {
      const built = materializeConstrainedSketch(sketchFromTemplate(kind), '#000000');
      expect(built.result).toMatchObject({ kind: 'solved', status: 'fully-constrained' });
      expect(built.paths?.length).toBe(kind === 'plate' ? 3 : 1);
      expect(built.paths?.flatMap((path) => path.polylines).every((line) => line.closed)).toBe(
        true,
      );
    },
  );
  it('creates custom rectangles, lines and circles with independent identities and exact dimensions', () => {
    const initial = sketchFromTemplate('custom');
    const rectangle = appendSketchPrimitive(initial, 'rectangle', [10, 20, 30, 15]);
    expect(rectangle).not.toBeNull();
    const line = appendSketchPrimitive(rectangle!, 'line', [0, 0, 3, 4]);
    const circle = appendSketchPrimitive(line!, 'circle', [60, 50, 8, 0]);
    const built = materializeConstrainedSketch(circle!, '#000000');
    expect(parseConstrainedSketch(circle).kind).toBe('ok');
    expect(built.paths).toHaveLength(3);
    expect(built.result).toMatchObject({ kind: 'solved', status: 'fully-constrained' });
    expect(built.bounds).toEqual({ minX: 0, minY: 0, maxX: 64, maxY: 54 });
    const profile = built.paths?.find((p) => p.polylines[0]?.points.length === 4)?.polylines[0];
    expect(profile).toEqual({
      closed: true,
      points: [
        { x: 10, y: 20 },
        { x: 40, y: 20 },
        { x: 40, y: 35 },
        { x: 10, y: 35 },
      ],
    });
    expect(initial.lines).toHaveLength(0);
  });
  it('removes an outline and its dependent relations without breaking the remaining circles', () => {
    const plate = sketchFromTemplate('plate');
    const next = removeSketchEntity(plate, 'profile', 'outline');
    expect(next.lines).toHaveLength(0);
    expect(next.points.map((p) => p.id)).toEqual(['hole1', 'hole2']);
    expect(parseConstrainedSketch(next).kind).toBe('ok');
    expect(materializeConstrainedSketch(next, '#000000').paths).toHaveLength(2);
    expect(plate.profiles).toHaveLength(1);
  });
  it('removes a circle and its position and diameter constraints without retaining unused solver freedom', () => {
    const next = removeSketchEntity(sketchFromTemplate('plate'), 'circle', 'mount1');
    expect(next.points.some((p) => p.id === 'hole1')).toBe(false);
    expect(parseConstrainedSketch(next).kind).toBe('ok');
    const built = materializeConstrainedSketch(next, '#000000');
    expect(built.result).toMatchObject({ kind: 'solved', status: 'fully-constrained' });
    expect(built.paths).toHaveLength(2);
  });
  it.each([
    ['circle', 'circle', [0, 0, 10, 0]],
    ['rectangle', 'profile', [0, 0, 20, 10]],
    ['line', 'line', [0, 0, 3, 4]],
  ] as const)(
    'keeps a replacement %s fully constrained after removing the final entity',
    (kind, entityKind, values) => {
      const created = appendSketchPrimitive(sketchFromTemplate('custom'), kind, values)!;
      const entity =
        entityKind === 'profile'
          ? created.profiles[0]
          : entityKind === 'circle'
            ? created.circles[0]
            : created.lines[0];
      const emptied = removeSketchEntity(created, entityKind, entity!.id);
      const replaced = appendSketchPrimitive(emptied, kind, values)!;
      expect(parseConstrainedSketch(replaced).kind).toBe('ok');
      expect(materializeConstrainedSketch(replaced, '#000000').result).toMatchObject({
        kind: 'solved',
        status: 'fully-constrained',
        degreesOfFreedom: 0,
      });
      expect(replaced.points).toHaveLength(created.points.length);
    },
  );
  it.each([{ values: [-999999, 0, 1500000, 10] }, { values: [0, -999999, 10, 1500000] }])(
    'rejects oversized rectangle parameters even when the corner coordinates fit',
    ({ values }) => {
      expect(appendSketchPrimitive(sketchFromTemplate('custom'), 'rectangle', values)).toBeNull();
    },
  );
  it('rejects a degenerate line, negative dimensions and over-budget geometry without mutation', () => {
    const sketch = sketchFromTemplate('custom');
    expect(appendSketchPrimitive(sketch, 'line', [1, 2, 1, 2])).toBeNull();
    expect(appendSketchPrimitive(sketch, 'rectangle', [0, 0, -5, 5])).toBeNull();
    expect(
      appendSketchPrimitive(
        { ...sketch, points: Array.from({ length: 32 }, (_, i) => ({ id: 'p' + i, x: i, y: 0 })) },
        'circle',
        [0, 0, 5, 0],
      ),
    ).toBeNull();
    expect(sketch.points).toHaveLength(1);
  });
});
