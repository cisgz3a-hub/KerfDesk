import { beforeEach, describe, expect, it } from 'vitest';
import type { SketchLine, SketchRectangle } from '../../core/design';
import { sketchDimensions } from '../../core/design/dimensions';
import { createDesignSession } from './design-session';
import { useDesignStudioStore } from './design-studio-store';
import { dimensionAtPoint, placedDimensions } from './design-dimension-annotation';
import { restoreDesignSession } from './design-session';

const base: SketchLine = { kind: 'line', id: 'a', start: { x: 0, y: 0 }, end: { x: 30, y: 0 } };
const riser: SketchLine = { kind: 'line', id: 'b', start: { x: 0, y: 0 }, end: { x: 0, y: 20 } };
const rect: SketchRectangle = {
  kind: 'rect',
  id: 'r',
  origin: { x: 50, y: 50 },
  widthMm: 40,
  heightMm: 20,
  cornerRadiusMm: 0,
};

const store = (): ReturnType<typeof useDesignStudioStore.getState> =>
  useDesignStudioStore.getState();
const session = () => {
  const current = store().session;
  if (current === null) throw new Error('expected an open session');
  return current;
};
const sketch = () => session().history.present;

beforeEach(() => {
  useDesignStudioStore.setState({
    session: { ...createDesignSession({ entities: [base, riser, rect] }), tool: 'dimension' },
    stash: null,
  });
});

describe('the Dimension tool', () => {
  it('dimensions a rectangle edge at once, driving and without moving anything', () => {
    store().dimensionAt({ x: 70, y: 50.2 }, 1, 'w');
    expect(sketchDimensions(sketch())).toEqual([
      { id: 'w', kind: 'rect-width', entityId: 'r', driving: true, value: 40 },
    ]);
    expect(session().activeDimensionId).toBe('w');
    expect(sketch().entities[2]).toEqual(rect);
    expect(session().history.past).toHaveLength(1);
  });

  it('waits on a line, then makes the angle with a second line', () => {
    store().dimensionAt({ x: 15, y: 0.1 }, 1, 'unused');
    expect(session().dimensionPendingLineId).toBe('a');
    expect(sketchDimensions(sketch())).toEqual([]);
    store().dimensionAt({ x: 0.1, y: 10 }, 1, 'ang');
    expect(sketchDimensions(sketch())[0]).toMatchObject({ kind: 'angle', value: 90 });
    expect(session().dimensionPendingLineId).toBeNull();
  });

  it('places a line length when the second click lands in empty space', () => {
    store().dimensionAt({ x: 15, y: 0.1 }, 1, 'unused');
    store().dimensionAt({ x: 200, y: 200 }, 1, 'len');
    expect(sketchDimensions(sketch())[0]).toMatchObject({ kind: 'line-length', value: 30 });
  });

  it('drives the geometry from a typed value as one undo step, and Undo restores it', () => {
    store().dimensionAt({ x: 70, y: 50.2 }, 1, 'w');
    store().driveDimension('w', 55);
    expect((sketch().entities[2] as SketchRectangle).widthMm).toBe(55);
    store().undo();
    expect((sketch().entities[2] as SketchRectangle).widthMm).toBe(40);
  });

  it('holds a driving value against a later inspector edit by typing it through', () => {
    store().dimensionAt({ x: 70, y: 50.2 }, 1, 'w');
    store().editEntityField('r', 'width', 62);
    expect((sketch().entities[2] as SketchRectangle).widthMm).toBe(62);
    expect(sketchDimensions(sketch())[0]?.value).toBe(62);
  });

  it('re-imposes a driving value after a stretch and lets a driven one follow', () => {
    store().dimensionAt({ x: 70, y: 50.2 }, 1, 'w');
    store().updateEntity({ ...rect, widthMm: 80 });
    expect((sketch().entities[2] as SketchRectangle).widthMm).toBe(40);
    store().setDimensionDriving('w', false);
    store().updateEntity({ ...rect, widthMm: 80 });
    expect((sketch().entities[2] as SketchRectangle).widthMm).toBe(80);
    expect(placedDimensions(sketch())[0]?.label).toBe('(80.00 mm)');
  });

  it('picks a placed dimension by its drawn line, and Delete removes only it', () => {
    store().dimensionAt({ x: 70, y: 50.2 }, 1, 'w');
    store().setActiveDimension(null);
    // The width dimension stands 8 mm off the rectangle's top edge.
    expect(dimensionAtPoint(sketch(), { x: 70, y: 78 }, 1)).toBe('w');
    store().dimensionAt({ x: 70, y: 78 }, 1, 'unused');
    expect(session().activeDimensionId).toBe('w');
    store().deleteSelected();
    expect(sketchDimensions(sketch())).toEqual([]);
    expect(sketch().entities).toHaveLength(3);
  });

  it('drops a dimension with its entity, and a malformed stored one on restore', () => {
    store().dimensionAt({ x: 70, y: 50.2 }, 1, 'w');
    store().setActiveDimension(null);
    store().setSelection(['r']);
    store().deleteSelected();
    expect(sketch().dimensions).toBeUndefined();
    const restored = restoreDesignSession({
      sketch: {
        entities: [rect],
        dimensions: [
          { id: 'x', kind: 'nonsense' } as never,
          { id: 'y', kind: 'rect-width', entityId: 'r', driving: true, value: 30 },
        ],
      },
      activeLayerId: 'design-layer-1',
      surface3d: false,
      applied: null,
    });
    expect(restored.history.present.dimensions).toHaveLength(1);
    expect((restored.history.present.entities[0] as SketchRectangle).widthMm).toBe(30);
  });
});
